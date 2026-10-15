import http from 'node:http';
import {timingSafeEqual} from 'node:crypto';
export function createControlServer({token,origin,scheduler,onRequest=()=>{}}){
  if(!/^[a-f0-9]{64}$/.test(token)||!/^chrome-extension:\/\/[a-p]{32}$/.test(origin))throw Error('Invalid companion pairing');
  return http.createServer(async(req,res)=>{
    onRequest({method:req.method,url:req.url,origin:req.headers.origin || '(absent)'});
    const send=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(value?JSON.stringify(value):undefined);};
    // Chrome privileged GET requests can omit Origin. The paired id is a
    // routing check, not authentication: the secret bearer remains mandatory.
    const pairedId=req.headers['x-recorder-extension']===origin.slice('chrome-extension://'.length);
    if(req.headers.origin ? req.headers.origin!==origin : !pairedId)return send(403,{error:'Untrusted origin'});
    res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');
    if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','GET, POST');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type, X-Recorder-Extension');return send(204);}
    const supplied=Buffer.from(req.headers.authorization || ''),expected=Buffer.from('Bearer '+token);
    if(supplied.length!==expected.length || !timingSafeEqual(supplied,expected))return send(401,{error:'Pairing required'});
    try{
      if(req.method==='GET' && req.url==='/health')return send(200,scheduler.snapshot());
      if(req.method==='POST' && req.url==='/schedules'){
        let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>65536)return send(413,{error:'Request too large'});}
        await scheduler.sync(JSON.parse(body));return send(200,{ok:true});
      }
      return send(404,{error:'Unknown operation'});
    }catch(error){send(400,{error:error.message});}
  });
}
