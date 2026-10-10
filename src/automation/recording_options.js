export function recorderOptions(mimeType,quality='standard'){
  const rates={economy:1000000,standard:2500000,high:5000000};
  if(!Object.hasOwn(rates,quality))throw Error('Unknown recording quality');
  return {mimeType,videoBitsPerSecond:rates[quality],audioBitsPerSecond:128000};
}
