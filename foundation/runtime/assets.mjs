const version = '1.0.0';
const object = (properties, required = Object.keys(properties)) => ({ type:'object', properties, required, additionalProperties:false });
const token = { type:'string', minLength:1, maxLength:128 };
const uuid = { type:'string', pattern:'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' };
const faults = {
  library:['NORMAL','BUSINESS_REJECT','TIMEOUT_AFTER_COMMIT','DUPLICATE_CALLBACK','OUT_OF_ORDER'],
  energy:['NORMAL','ACK_ONLY','STARTED_RESPONSE_LOST','STOP_UNKNOWN','METER_RESET','FINAL_READING_LATE','DUPLICATE_EVENT'],
  parcel:['NORMAL','OPEN_RESPONSE_LOST','OPEN_NO_COLLECTION','WRONG_COMPARTMENT','DUPLICATE_HANDOVER'],
};
const faultSchema = name => ({ type:'string', enum:faults[name] });
const path = value => ({ path:value });
const literal = value => ({ literal:value });

export const packages = ['library','energy','locker'].map(code => ({
  code:'demo-' + code,
  version,
  manifest:{ mode:'DEMO', network:false, sdkVersion:1, query:true },
}));

export const contracts = [
  {
    code:'library.reservation.create', version,
    inputSchema:object({bookId:token, subjectId:token, fault:faultSchema('library')}, ['bookId','subjectId']),
    outputSchema:object({reservationId:uuid, bookId:token, state:{const:'RESERVED'}}),
    manifest:{packageCode:'demo-library', sideEffect:'LOGICAL_WRITE', retryClass:'QUERY_BEFORE_RETRY', hasQuery:true, authority:'demo-library'},
  },
  {
    code:'energy.session.start', version,
    inputSchema:object({portId:uuid, quoteId:uuid, fault:faultSchema('energy')}, ['portId','quoteId']),
    outputSchema:object({externalSessionId:uuid, accepted:{const:true}}),
    manifest:{packageCode:'demo-energy', sideEffect:'PHYSICAL', retryClass:'QUERY_BEFORE_RETRY', hasQuery:true, authority:'demo-energy', acceptedMeans:'COMMAND_ACCEPTED'},
  },
  {
    code:'energy.session.stop', version,
    inputSchema:object({externalSessionId:uuid, fault:faultSchema('energy')}, ['externalSessionId']),
    outputSchema:object({externalSessionId:uuid, accepted:{const:true}}),
    manifest:{packageCode:'demo-energy', sideEffect:'PHYSICAL', retryClass:'QUERY_BEFORE_RETRY', hasQuery:true, authority:'demo-energy', acceptedMeans:'COMMAND_ACCEPTED'},
  },
  {
    code:'parcel.compartment.unlock', version,
    inputSchema:object({pickupId:uuid, fault:faultSchema('parcel')}, ['pickupId']),
    outputSchema:object({pickupId:uuid, state:{const:'OPEN_CONFIRMED'}}),
    manifest:{packageCode:'demo-locker', sideEffect:'PHYSICAL', retryClass:'QUERY_BEFORE_RETRY', hasQuery:true, authority:'demo-locker'},
  },
];
const incident = (id, category) => ({ id,type:'incident',category,resumePolicy:'OPERATION_RESULT_ONLY' });
const end = (id,outcome) => ({id,type:'end',outcome});
const failure = end('technical_failure','TECHNICAL_FAILURE');
const rejected = end('rejected','REJECTED');
const timed = incident('timed_out','WAIT_TIMEOUT');
const wait = (id,eventType,correlationPath,onEvent) => ({
  id,type:'waitEvent',eventType,correlationPath,outputKey:id,timeoutSeconds:30,onEvent,onTimeout:'timed_out',
});
const action = (id,bindingCode,input,outputKey,onSuccess) => ({
  id,type:'action',bindingCode,input,outputKey,onSuccess,onRejected:'rejected',onUnknown:'uncertain',onFailure:'technical_failure',
});

export const templates = [
  {
    code:'library-reservation', name:'图书预约样板', scenarioCode:'LIBRARY_RESERVATION',
    authorityPolicy:{authority:'demo-library', reservation:'DEMO_PROVIDER', pickup:'LOCAL_STAFF_CONFIRMATION'},
    definition:{
      schemaVersion:1, form:object({bookId:token,fault:faultSchema('library')},['bookId']),
      policy:{authority:'demo-library',maxSteps:20},
      workflow:{start:'reserve',nodes:[
        action('reserve','library.reservation.create',{bookId:path('form.bookId'),subjectId:path('identity.subjectId'),fault:path('form.fault')},'reservation','review'),
        {id:'review',type:'human',role:'OPERATOR',scope:{type:'SERVICE',id:path('system.serviceId')},form:object({ready:{type:'boolean'},reason:{type:'string',maxLength:500}},['ready']),outputKey:'review',timeoutSeconds:86400,onComplete:'review_result',onTimeout:'timed_out'},
        {id:'review_result',type:'condition',path:'outputs.review.ready',operator:'eq',value:true,whenTrue:'done',whenFalse:'rejected'},
        incident('uncertain','LIBRARY_RECONCILIATION'),timed,failure,rejected,end('done','READY_FOR_PICKUP'),
      ]},
    },
  },
  {
    code:'energy-charge', name:'充电会话模拟', scenarioCode:'ENERGY_CHARGE',
    authorityPolicy:{authority:'demo-energy', session:'DEMO_PROVIDER', billing:'DEMO_METER_EVIDENCE'},
    definition:{
      schemaVersion:1,form:object({portId:uuid,quoteId:uuid,fault:faultSchema('energy')},['portId','quoteId']),
      policy:{authority:'demo-energy',maxSteps:20,requiredBindings:['energy.session.stop']},
      workflow:{start:'start_charge',nodes:[
        action('start_charge','energy.session.start',{portId:path('form.portId'),quoteId:path('form.quoteId'),fault:path('form.fault')},'command','started'),
        wait('started','energy.session.started','outputs.command.externalSessionId','ended'),
        {...wait('ended','energy.session.ended','outputs.command.externalSessionId','done'),timeoutSeconds:86400},
        incident('uncertain','ENERGY_START_RECONCILIATION'),timed,failure,rejected,end('done','CHARGING_ENDED'),
      ]},
    },
  },
  {
    code:'parcel-pickup', name:'柜体取件模拟', scenarioCode:'LOCKER_PICKUP',
    authorityPolicy:{authority:'demo-locker', door:'DEMO_PROVIDER', handover:'SEPARATE_DEMO_EVENT'},
    definition:{
      schemaVersion:1,form:object({pickupId:uuid,fault:faultSchema('parcel')},['pickupId']),
      policy:{authority:'demo-locker',maxSteps:20},
      workflow:{start:'unlock',nodes:[
        action('unlock','parcel.compartment.unlock',{pickupId:path('form.pickupId'),fault:path('form.fault')},'door','collected'),
        wait('collected','parcel.collected','outputs.door.pickupId','done'),
        incident('uncertain','LOCKER_RECONCILIATION'),timed,failure,rejected,end('done','PARCEL_COLLECTED'),
      ]},
    },
  },
];
const fixtureId = '10000000-0000-4000-8000-000000000001';
const fixtures = [
  [{bookId:'demo-book',subjectId:'demo-reader'}, {reservationId:fixtureId,bookId:'demo-book',state:'RESERVED'}],
  [{portId:fixtureId,quoteId:fixtureId}, {externalSessionId:fixtureId,accepted:true}],
  [{externalSessionId:fixtureId}, {externalSessionId:fixtureId,accepted:true}],
  [{pickupId:fixtureId}, {pickupId:fixtureId,state:'OPEN_CONFIRMED'}],
];
for (const [index, contract] of contracts.entries()) {
  [contract.fixtureInput, contract.fixtureOutput] = fixtures[index];
}

export const assets = { packages, contracts, templates };
export { faults };
