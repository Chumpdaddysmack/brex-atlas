import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogHeader } from "@/components/ui/dialog";
import { ClientReportView } from "@/pages/client-report";
import type { ShareSummary, SharedReport } from "@shared/client-report";
import { BOOKING_URL } from "@shared/client-report";
import { Share2, Copy, ExternalLink } from "lucide-react";

export function ReportSharing({analysisId}:{analysisId:string}) {
  const [open,setOpen]=useState(false),[mode,setMode]=useState<"full"|"demo">("full"),[reviewed,setReviewed]=useState(false);
  const [preview,setPreview]=useState<SharedReport & {previewHash:string}|null>(null),[showPreview,setShowPreview]=useState(false);
  const [protect,setProtect]=useState(true),[code,setCode]=useState(""),[newLink,setNewLink]=useState("");
  const [confirmRevoke,setConfirmRevoke]=useState<string|null>(null),[copied,setCopied]=useState(false),[copyError,setCopyError]=useState(false);
  const query=useQueryClient();
  const list=useQuery<ShareSummary[]>({queryKey:["/api/analyses",analysisId,"report-shares"],queryFn:async()=>(await apiRequest("GET",`/api/analyses/${analysisId}/report-shares`)).json(),enabled:open});
  const loadPreview=useMutation({mutationFn:async()=>(await apiRequest("GET",`/api/analyses/${analysisId}/client-report-preview?mode=${mode}`)).json(),
    onSuccess:data=>{setPreview(data);setReviewed(false);setShowPreview(true);}});
  const publish=useMutation({mutationFn:async()=>(await apiRequest("POST",`/api/analyses/${analysisId}/report-shares`,{mode,reviewed:true,previewHash:preview?.previewHash,...(protect?{accessCode:code}:{})})).json(),
    onSuccess:async data=>{setNewLink(`${window.location.origin}${data.path}`);setReviewed(false);setCopied(false);await query.invalidateQueries({queryKey:["/api/analyses",analysisId,"report-shares"]});}});
  const change=useMutation({mutationFn:async({id,action}:{id:string;action:"extend"|"revoke"})=>(await apiRequest("PATCH",`/api/analyses/${analysisId}/report-shares/${id}`,{action})).json(),
    onSuccess:async()=>{setConfirmRevoke(null);await query.invalidateQueries({queryKey:["/api/analyses",analysisId,"report-shares"]});}});
  const error=loadPreview.error??publish.error??change.error;
  return <>
    <Button variant="outline" data-testid="open-report-sharing" onClick={()=>setOpen(true)}><Share2 className="w-4 h-4 mr-2"/>Publish client report</Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
      <DialogHeader><DialogTitle>Publish a client report</DialogTitle><DialogDescription>A read-only snapshot, available for 10 days from publication. Publishing creates a link; it does not email the prospect.</DialogDescription></DialogHeader>
      <div className="space-y-5">
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="text-sm font-medium">Report version<select data-testid="share-mode" className="mt-2 block w-full rounded-md border p-2 bg-background" value={mode} onChange={e=>{setMode(e.target.value as any);setPreview(null);setReviewed(false);}}>
            <option value="full">Full client report</option><option value="demo">Demo excerpts only</option></select></label>
          <div className="text-sm rounded-lg bg-muted/40 p-3"><p className="font-medium">Discuss your report</p><a href={BOOKING_URL} target="_blank" rel="noreferrer" className="text-xs underline break-all">Existing Brex booking page</a><p className="text-xs text-muted-foreground mt-1">Expired links offer “Request renewed access.”</p></div>
        </div>
        <p className="text-sm text-muted-foreground">Includes the saved report visuals and content plan. Full links include an evidence-approved service recommendation, if available. Internal intake notes, editing controls, raw SOW drafts, and unapproved ROI forecasts are excluded.</p>
        <Button variant="outline" data-testid="preview-client-report" disabled={loadPreview.isPending} onClick={()=>loadPreview.mutate()}>{loadPreview.isPending?"Preparing preview…":"Review client preview"}<ExternalLink className="ml-2 w-4 h-4"/></Button>
        <div className="space-y-3 border rounded-lg p-4">
          <label className="flex gap-2 text-sm font-medium"><input data-testid="protect-report" type="checkbox" checked={protect} onChange={e=>setProtect(e.target.checked)}/>Require an access code (recommended)</label>
          {protect?<><Input aria-label="Client report access code" data-testid="share-access-code" type="password" autoComplete="new-password" value={code} onChange={e=>setCode(e.target.value)} placeholder="At least 8 characters"/><p className="text-xs text-muted-foreground">Send the code separately. This is code protection, not email identity verification. Only a salted hash is stored.</p></>:<p className="text-xs text-muted-foreground">Anyone with the unique link can view it until it expires or is revoked. Avoid this option for confidential reports.</p>}
        </div>
        <label className="flex gap-2 items-start text-sm"><input className="mt-1" data-testid="confirm-report-reviewed" type="checkbox" checked={reviewed} disabled={!preview} onChange={e=>setReviewed(e.target.checked)}/><span>I reviewed this {mode} preview and approve its contents for client access. Copies and screenshots cannot be retracted.</span></label>
        {error&&<p className="text-sm text-destructive" role="alert">{error.message}</p>}
        <Button data-testid="publish-report" disabled={!preview||!reviewed||publish.isPending||(protect&&code.length<8)} onClick={()=>publish.mutate()}>{publish.isPending?"Publishing…":"Publish for 10 days"}</Button>
        {newLink&&<div className="border border-primary/30 bg-primary/5 rounded-lg p-4 space-y-3">
          <p className="text-sm font-semibold">Client link ready. Copy and save it now.</p>
          <Input aria-label="Published report link" data-testid="published-report-link" value={newLink} readOnly/>
          <p className="text-xs text-muted-foreground">For protection, the token is not recoverable from link history. Keep your copy, or publish a new link later.</p>
          <div className="flex gap-2 flex-wrap"><Button variant="outline" data-testid="copy-report-link" onClick={async()=>{try{await navigator.clipboard.writeText(newLink);setCopied(true);setCopyError(false);}catch{setCopyError(true);}}}><Copy className="mr-2 w-4 h-4"/>{copied?"Copied":"Copy link"}</Button>
            <Button asChild variant="outline"><a href={newLink} target="_blank" rel="noreferrer">Open client link</a></Button></div>{copyError&&<p className="text-xs">Clipboard unavailable. Select and copy the link field instead.</p>}
        </div>}
        <section className="border-t pt-4 space-y-3"><h3 className="text-sm font-semibold">Published links</h3>
          {list.isPending&&<p className="text-sm">Loading…</p>}{list.isError&&<p className="text-sm text-destructive" role="alert">Could not load link history. <button className="underline" onClick={()=>list.refetch()}>Retry</button></p>}
          {list.data?.length===0&&<p className="text-sm text-muted-foreground">No client links have been published for this analysis.</p>}
          {list.data?.map(r=><div key={r.id} className="border rounded-lg p-3 space-y-2" data-testid={`share-row-${r.id}`}>
            <p className="text-sm font-medium">{r.mode==="full"?"Full report":"Demo preview"} · {r.revokedAt?"Revoked":Date.now()>=r.expiresAt?"Expired":"Active"} · {r.protected?"Access code":"Link access"}</p>
            <p className="text-xs text-muted-foreground">Published {new Date(r.createdAt).toLocaleString()} · Expires {new Date(r.expiresAt).toLocaleString()}</p>
            {!r.revokedAt&&<div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={change.isPending} data-testid={`extend-share-${r.id}`} onClick={()=>change.mutate({id:r.id,action:"extend"})}>Extend 10 days</Button>
              {confirmRevoke===r.id?<><Button size="sm" variant="destructive" disabled={change.isPending} data-testid={`confirm-revoke-${r.id}`} onClick={()=>change.mutate({id:r.id,action:"revoke"})}>Confirm revoke</Button><Button size="sm" variant="ghost" onClick={()=>setConfirmRevoke(null)}>Cancel</Button></>
                :<Button size="sm" variant="ghost" data-testid={`revoke-share-${r.id}`} onClick={()=>setConfirmRevoke(r.id)}>Revoke link</Button>}
            </div>}
          </div>)}
        </section>
      </div>
    </DialogContent></Dialog>
    <Dialog open={showPreview} onOpenChange={setShowPreview}><DialogContent className="max-w-[95vw] w-[95vw] max-h-[94vh] overflow-y-auto p-0">
      <DialogHeader className="p-5 border-b"><DialogTitle>Client preview · not yet published</DialogTitle><DialogDescription>Review each tab, then close this preview to approve publication.</DialogDescription></DialogHeader>
      {preview&&<ClientReportView data={preview} preview/>}
    </DialogContent></Dialog>
  </>;
}
