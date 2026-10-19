export const VERSION:string;
export const questions:Array<{key:string;name:string;question:string;options:string[];next:string}>;
export function assess(answers:Record<string,string>):{
  version:string;score:number|null;known:number;status:string;band:string;
  constraints:string[];next:string;items:Array<{key:string;name:string;question:string;options:string[];next:string;points:number|null}>;
};
