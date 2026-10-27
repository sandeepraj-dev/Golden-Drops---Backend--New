export const validate=(schema)=> (req,res,next)=>{try{const out=schema.parse({body:req.body,query:req.query,params:req.params});req.validated=out;next()}catch(e){next(e)}};
