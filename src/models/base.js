import mongoose from 'mongoose'; import Counter from './Counter.js';
export async function nextId(name,session){const opts=session?{session}:{};const c=await Counter.findOneAndUpdate({_id:name},{$inc:{seq:1}}, {new:true,upsert:true,setDefaultsOnInsert:true,...opts});return c.seq}
export function commonSchema(extra={},opts={}){return new mongoose.Schema({id:{type:Number,unique:true,index:true},isActive:{type:Boolean,default:true},...extra},{timestamps:true,strict:'throw',...opts})}
export function assignId(schema,name){schema.pre('validate',async function(){if(this.isNew&&this.id==null)this.id=await nextId(name,this.$session())})}
