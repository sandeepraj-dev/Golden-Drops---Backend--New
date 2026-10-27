import bcrypt from 'bcryptjs';
import {env} from './config/env.js';
import {connectDB} from './config/db.js';
import app from './app.js';
import User from './models/User.js';
try {
 await connectDB(env.MONGODB_URI);
 let admin=await User.findOne({username:env.ADMIN_USERNAME.toLowerCase()});
 if(!admin){admin=await User.create({username:env.ADMIN_USERNAME,passwordHash:await bcrypt.hash(env.ADMIN_PASSWORD,12),role:'ADMIN'});console.log(`[BOOT] Initial admin created: username=${env.ADMIN_USERNAME}. Change the configured password immediately.`)}
 const server=app.listen(env.PORT,()=>console.log(`[BOOT] Oil Broker API listening at http://localhost:${env.PORT}`));
 console.log(`[BOOT] API base: http://localhost:${env.PORT}/api/v1 | Swagger: http://localhost:${env.PORT}/api-docs`);
 const shutdown=signal=>{console.log(`[SHUTDOWN] ${signal} received`);server.close(()=>process.exit(0));setTimeout(()=>process.exit(1),10000).unref()};process.on('SIGINT',()=>shutdown('SIGINT'));process.on('SIGTERM',()=>shutdown('SIGTERM'));
} catch(err){console.error('[BOOT ERROR] Startup failed:',err.message);process.exit(1)}
