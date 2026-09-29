import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { isIP } from "node:net";

export interface PageEvidence { url: string; title: string; text: string }

// Public widget inputs must never reach local networks, metadata services or
// redirected private endpoints. Pin the validated IPv4 address for each hop.
export function publicIpv4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [a,b,c]=address.split(".").map(Number);
  return !(a===0||a===10||a===127||a>=224||
    (a===100&&b>=64&&b<=127)||(a===169&&b===254)||
    (a===172&&b>=16&&b<=31)||(a===192&&(b===168||b===0||b===2))||
    (a===198&&(b===18||b===19||(b===51&&c===100)))||
    (a===203&&b===0&&c===113));
}
function allowedUrl(raw:string,officialUrl:string):URL {
  const u=new URL(raw), official=new URL(officialUrl);
  if (!["https:","http:"].includes(u.protocol)||u.username||u.password||u.port||
    isIP(u.hostname)||u.hostname.replace(/^www\./,"")!==official.hostname.replace(/^www\./,""))
    throw new Error("UNSAFE_EVIDENCE_URL");
  u.hash=""; return u;
}
function decodeEntities(text:string) {
  return text.replace(/&#(x[0-9a-f]+|\d+);/gi,(_,n)=>{
    const point=n[0].toLowerCase()==="x"?parseInt(n.slice(1),16):parseInt(n,10);
    return point>0&&point<=0x10ffff?String.fromCodePoint(point):" ";
  }).replace(/&(?:nbsp|amp|quot|apos|lt|gt);/g,s=>({
    "&nbsp;":" ","&amp;":"&","&quot;":'"',"&apos;":"'","&lt;":"<","&gt;":">"
  }[s]||s));
}
export function evidenceText(html:string):string {
  return decodeEntities(html.replace(/<!--[\s\S]*?-->/g," ")
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi," ")
    .replace(/<[^>]+>/g," ")).replace(/\s+/g," ").trim();
}
export async function readOfficialPage(raw:string,officialUrl:string):Promise<PageEvidence|null> {
  try{
    let u=allowedUrl(raw,officialUrl);
    for(let hop=0;hop<4;hop++){
      const records=await lookup(u.hostname,{all:true,family:4});
      if(!records.length||records.some(r=>!publicIpv4(r.address)))return null;
      const address=records[0].address;
      const result=await new Promise<{status:number;location?:string;type:string;html:string}>((resolve,reject)=>{
        const request=u.protocol==="https:"?httpsRequest:httpRequest;
        const req=request(u,{
          agent:false,
          headers:{"User-Agent":"BrexAtlasResearch/1.0","Accept":"text/html,application/xhtml+xml","Accept-Encoding":"identity"},
          signal:AbortSignal.timeout(10000),
          lookup:((_hostname:any,options:any,callback:any)=>{
            callback(null,options?.all?[{address,family:4}]:address,4);
          }) as any,
        },res=>{
          const status=res.statusCode||0;
          if(status>=300&&status<400){
            res.resume();resolve({status,location:res.headers.location,type:"",html:""});return;
          }
          const type=String(res.headers["content-type"]||"");
          if(status!==200||!/text\/html|application\/xhtml\+xml/i.test(type)){
            res.resume();resolve({status,type,html:""});return;
          }
          const chunks:Buffer[]=[];let bytes=0;
          res.on("data",(chunk:Buffer)=>{
            bytes+=chunk.length;
            if(bytes>1500000){req.destroy(new Error("EVIDENCE_TOO_LARGE"));return;}
            chunks.push(chunk);
          });
          res.on("error",reject);
          res.on("end",()=>resolve({status,type,html:Buffer.concat(chunks).toString("utf8")}));
        });
        req.on("error",reject);req.end();
      });
      if(result.status>=300&&result.status<400&&result.location){
        u=allowedUrl(new URL(result.location,u).toString(),officialUrl);continue;
      }
      const text=evidenceText(result.html).slice(0,24000);
      if(result.status!==200||text.length<150)return null;
      const title=evidenceText(result.html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]||u.hostname);
      return {url:u.toString(),title:title.slice(0,200),text};
    }
  }catch{/* A blocked/unreadable page is not evidence. */}
  return null;
}
