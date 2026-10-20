const {chromium,webkit}=require('playwright');

// Keep browser selection and local executable overrides consistent across suites.
// Each test file still owns its browser lifecycle and isolated contexts.
function launchBrowser({engine=process.env.BROWSER_ENGINE||'chromium',...options}={}){
  if(!['chromium','webkit'].includes(engine))throw new Error('Unsupported BROWSER_ENGINE: '+engine);
  return ({chromium,webkit}[engine]).launch({headless:true,
    ...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{}),...options});
}
module.exports={launchBrowser};
