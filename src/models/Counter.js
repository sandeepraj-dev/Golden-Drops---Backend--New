import mongoose from 'mongoose'; export default mongoose.model('Counter',new mongoose.Schema({_id:String,seq:{type:Number,default:100}}));
