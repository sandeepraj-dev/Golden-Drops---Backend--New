import {asyncHandler,ok,AppError} from '../utils/errors.js';import {paginated} from '../utils/pagination.js';import Manufacturer from '../models/Manufacturer.js';import Supplier from '../models/Supplier.js';import OilType from '../models/OilType.js';import Purchase from '../models/Purchase.js';import Sale from '../models/Sale.js';import BusinessSettings from '../models/BusinessSettings.js';
const models={manufacturers:Manufacturer,suppliers:Supplier,'oil-types':OilType};const keys={manufacturers:'manufacturer',suppliers:'supplier','oil-types':'oilType'};
export const listMaster=asyncHandler(async(req,res)=>{
  const resource=req.params.resource;
  const Model=models[resource];
  const filter={};
  const active=String(req.query.active??'').toLowerCase();
  if(['true','t','1','yes'].includes(active))filter.isActive=true;
  if(['false','f','0','no'].includes(active))filter.isActive=false;
  if(req.query.search){
    const search=String(req.query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or=[
      {name:{$regex:search,$options:'i'}},
      {code:{$regex:search,$options:'i'}},
      {phone:{$regex:search,$options:'i'}}
    ];
  }
  // Only Oil Types use the user-defined sequence. Other master lists retain
  // their existing newest-first ordering.
  const sort=resource==='oil-types'
    ? {sequence:1,createdAt:1,id:1,_id:1}
    : {createdAt:-1};
  ok(res,await paginated(Model,filter,req.query,sort));
});
export const getMaster=asyncHandler(async(req,res)=>{const doc=await models[req.params.resource].findOne({id:Number(req.params.id)});if(!doc)throw new AppError('Record not found',404);ok(res,doc)});
export const createMaster=asyncHandler(async(req,res)=>{
  const resource=req.params.resource;
  const Model=models[resource];
  const data={...req.body};
  if(resource==='oil-types' && data.sequence===undefined){
    const latest=await OilType.findOne({}).sort({sequence:-1,id:-1}).select('sequence').lean();
    data.sequence=Number(latest?.sequence??0)+1;
  }
  if(resource==='suppliers'&&data.isDefault){
    await Supplier.updateMany({isDefault:true},{isDefault:false});
  }
  const doc=await Model.create(data);
  if(resource==='suppliers'&&doc.isDefault){
    await BusinessSettings.findOneAndUpdate({key:'main'},{defaultSupplierId:doc.id},{upsert:true,new:true});
  }
  ok(res,doc,'Created successfully',201);
});
export const updateMaster=asyncHandler(async(req,res)=>{const Model=models[req.params.resource];const doc=await Model.findOne({id:Number(req.params.id)});if(!doc)throw new AppError('Record not found',404);if(req.params.resource==='suppliers'&&req.body.isDefault===true)await Supplier.updateMany({isDefault:true,_id:{$ne:doc._id}},{isDefault:false});Object.assign(doc,req.body);await doc.save();if(req.params.resource==='suppliers'&&doc.isDefault)await BusinessSettings.findOneAndUpdate({key:'main'},{defaultSupplierId:doc.id},{upsert:true});ok(res,doc,'Updated successfully')});
export const deactivateMaster=asyncHandler(async(req,res)=>{const Model=models[req.params.resource],id=Number(req.params.id);const doc=await Model.findOne({id});if(!doc)throw new AppError('Record not found',404);if(req.params.resource==='manufacturers'&&await Purchase.exists({manufacturerId:id,status:'COMPLETED'})){}if(req.params.resource==='oil-types'&&(await Purchase.exists({oilTypeId:id,status:'COMPLETED'})||await Sale.exists({'items.oilTypeId':id,status:'COMPLETED'}))){}if(req.params.resource==='suppliers'&&doc.isDefault){const sales=await Sale.exists({supplierId:id,status:'COMPLETED'});if(sales)throw new AppError('Default supplier has sales history; configure another default supplier first',409);await BusinessSettings.findOneAndUpdate({key:'main'},{defaultSupplierId:null})}doc.isActive=false;if(doc.isDefault)doc.isDefault=false;await doc.save();ok(res,doc,'Deactivated successfully')});
