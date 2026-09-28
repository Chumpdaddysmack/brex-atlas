import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { setupAuth } from "./auth";

test("Supabase sessions initialize without a native global WebSocket (Node 20)",()=>{
  const saved={...process.env};
  const original=Object.getOwnPropertyDescriptor(globalThis,"WebSocket");
  try{
    Object.defineProperty(globalThis,"WebSocket",{value:undefined,configurable:true,writable:true});
    process.env.SUPABASE_URL="https://qa-placeholder.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY="test-placeholder-not-real";
    process.env.ADMIN_PASSWORD="local-qa-only";
    process.env.SESSION_SECRET="local-qa-only";
    assert.doesNotThrow(()=>setupAuth(express()));
  }finally{
    for(const key of ["SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","ADMIN_PASSWORD","SESSION_SECRET"]){
      if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];
    }
    if(original)Object.defineProperty(globalThis,"WebSocket",original);
    else delete (globalThis as any).WebSocket;
  }
});
