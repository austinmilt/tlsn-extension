import {
  onBeforeHeadersAutoNotarize as onBeforeSendHeadersAutoNotarize,
  onBeforeRequest,
  onBeforeRequestStoreBody,
  onResponseStarted,
  onSendHeaders,
} from './handlers';
import { deleteCacheByTabId } from './cache';
import browser from 'webextension-polyfill';

(async () => {
  browser.webRequest.onSendHeaders.addListener(
    onSendHeaders,
    {
      urls: ['<all_urls>'],
    },
    ['requestHeaders', 'extraHeaders'],
  );

  browser.webRequest.onBeforeRequest.addListener(
    onBeforeRequest,
    {
      urls: ['<all_urls>'],
    },
    ['requestBody'],
  );

  browser.webRequest.onResponseStarted.addListener(
    onResponseStarted,
    {
      urls: ['<all_urls>'],
    },
    ['responseHeaders', 'extraHeaders'],
  );

  browser.tabs.onRemoved.addListener((tabId) => {
    deleteCacheByTabId(tabId);
  });

  browser.webRequest.onBeforeRequest.addListener(
    onBeforeRequestStoreBody,
    // filters must match with those used to call onBeforeSendHeadersAutoNotarize
    {
      urls: ['*://api.twitter.com/1.1/account/settings.json*'],
      types: ['xmlhttprequest'],
    },
    ['requestBody'],
  );

  browser.webRequest.onBeforeSendHeaders.addListener(
    onBeforeSendHeadersAutoNotarize,
    // filters must match with those used to call onBeforeRequestStoreBody
    {
      urls: ['*://api.twitter.com/1.1/account/settings.json*'],
      types: ['xmlhttprequest'],
    },
    ['requestHeaders', 'extraHeaders'],
  );

  const { initRPC } = await import('./rpc');
  await createOffscreenDocument();
  initRPC();
})();

let creatingOffscreen: any;
async function createOffscreenDocument() {
  const offscreenUrl = browser.runtime.getURL('offscreen.html');
  // @ts-ignore
  const existingContexts = await browser.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl],
  });

  if (existingContexts.length > 0) {
    return;
  }

  if (creatingOffscreen) {
    await creatingOffscreen;
  } else {
    creatingOffscreen = (chrome as any).offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['WORKERS'],
      justification: 'workers for multithreading',
    });
    await creatingOffscreen;
    creatingOffscreen = null;
  }
}
