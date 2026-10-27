import mongoose from 'mongoose';
import { nextId } from './base.js';
const schema = new mongoose.Schema({id:{type:Number,unique:true,index:true},username:{type:String,required:true,unique:true,trim:true,lowercase:true},passwordHash:{type:String,required:true,select:false},role:{type:String,enum:['ADMIN'],default:'ADMIN'},isActive:{type:Boolean,default:true}},{timestamps:true});
schema.pre('validate',async function(){if(this.isNew&&this.id==null)this.id=await nextId('user',this.$session())});
export default mongoose.model('User',schema);
