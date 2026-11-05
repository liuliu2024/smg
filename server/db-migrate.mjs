// The existing demo bootstrap is idempotent and includes safe demo catalog seeds.
await import('./main.mjs');
const {db}=await import('./db.mjs');
const errors=db.prepare('PRAGMA foreign_key_check').all();
if(errors.length){console.error('数据库外键检查失败；未删除原始业务记录。',errors);process.exitCode=1}else console.log('领域表迁移及外键检查完成（包含幂等演示初始化）');
db.close();
