import mongoose from 'mongoose';
export async function connectDB(uri){mongoose.set('strictQuery',true); await mongoose.connect(uri,{serverSelectionTimeoutMS:10000}); console.log(`MongoDB connected: ${mongoose.connection.name}`)}
export async function withTransaction(fn){const session=await mongoose.startSession();try{let result;await session.withTransaction(async()=>{result=await fn(session)});return result}finally{await session.endSession()}}
