const $=id=>document.getElementById(id);
const status=$('telegramStatus');
const request=async message=>{
  const result=await chrome.runtime.sendMessage(message);
  if(!result?.ok)throw Error(result?.error || 'Telegram request failed');
  return result;
};
async function refresh(){
  const config=await request({type:'TELEGRAM_STATUS'});
  $('telegramEnabled').checked=config.enabled;
  $('telegramChatId').value=config.chatId;
  $('telegramToken').value='';
  status.textContent=config.configured
    ? `Telegram ${config.enabled?'enabled':'disabled'} · ${config.queued} pending · ${config.status?.state||'no delivery yet'}`
    : 'Telegram alerts not configured.';
}
$('telegramSave').addEventListener('click',async()=>{
  status.textContent='Saving Telegram settings…';
  try{
    await request({type:'TELEGRAM_SAVE_CONFIG',enabled:$('telegramEnabled').checked,
      token:$('telegramToken').value.trim(),chatId:$('telegramChatId').value.trim()});
    await refresh();status.textContent='Telegram settings saved locally. Use Send test message to verify delivery.';
  }catch(error){status.textContent='Telegram settings not saved: '+error.message;}
});
$('telegramTest').addEventListener('click',async()=>{
  status.textContent='Sending test message…';
  try{await request({type:'TELEGRAM_TEST'});await refresh();status.textContent='Test message sent. Check Telegram.';}
  catch(error){status.textContent='Test failed: '+error.message;}
});
refresh().catch(error=>{status.textContent='Cannot load Telegram settings: '+error.message;});
