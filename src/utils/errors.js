export class AppError extends Error {constructor(message,status=400,code='APP_ERROR'){super(message);this.status=status;this.code=code}}
export const asyncHandler=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
export const ok=(res,data,message='Success',status=200)=>res.status(status).json({success:true,message,data});
