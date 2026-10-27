import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import {env} from '../config/env.js';
import {asyncHandler,ok,AppError} from '../utils/errors.js';
export const login=asyncHandler(async(req,res)=>{const username=String(req.body.username||'').toLowerCase().trim();const user=await User.findOne({username,isActive:true}).select('+passwordHash');if(!user||!(await bcrypt.compare(String(req.body.password||''),user.passwordHash)))throw new AppError('Invalid username or password',401,'INVALID_CREDENTIALS');const token=jwt.sign({sub:String(user.id),username:user.username,role:user.role},env.JWT_SECRET,{expiresIn:env.JWT_EXPIRES_IN});console.log(`[AUTH] successful login user=${user.username} id=${user.id}`);ok(res,{tokenType:'Bearer',accessToken:token,expiresIn:env.JWT_EXPIRES_IN,user:{id:user.id,username:user.username,role:user.role}},'Login successful')});
