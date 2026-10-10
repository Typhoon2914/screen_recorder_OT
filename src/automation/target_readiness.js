// Page loading is observable; Teams authentication, lobby and admission are not
// inferred from URL, title, or document-ready state.
export async function prepareTarget(tabs,targetUrl,rememberedTabId=null){
  const url=new URL(targetUrl);
  if(url.protocol!=='https:' || url.username || url.password)throw Error('Unsafe capture target URL');
  const all=await tabs.query({});
  const target=all.find(tab=>tab.url===url.href || tab.pendingUrl===url.href) || all.find(tab=>tab.id===rememberedTabId);
  if(!target){
    const created=await tabs.create({url:url.href,active:false});
    return {ready:false,reason:'target_opening',tabId:created?.id,meetingJoinedVerified:false};
  }
  if(target.url!==url.href)return {ready:false,reason:'target_redirected',tabId:target.id,meetingJoinedVerified:false};
  return {ready:target.status==='complete',reason:target.status==='complete'?'page_loaded_only':'target_loading',tabId:target.id,meetingJoinedVerified:false};
}
