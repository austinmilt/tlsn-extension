import { getCacheByTabId } from './cache';
import { BackgroundActiontype, RequestLog, handleProveRequestStart } from './rpc';
import mutex from './mutex';
import browser from 'webextension-polyfill';
import { addRequest, notarizeRequest } from '../../reducers/requests';
import { urlify } from '../../utils/misc';
import { MAX_TRANSCRIPT_SIZE } from '../../utils/constants';

export const onSendHeaders = (
    details: browser.WebRequest.OnSendHeadersDetailsType,
) => {
    return mutex.runExclusive(async () => {
        const { method, tabId, requestId } = details;

        if (method !== 'OPTIONS') {
            const cache = getCacheByTabId(tabId);
            const existing = cache.get<RequestLog>(requestId);
            cache.set(requestId, {
                ...existing,
                method: details.method as 'GET' | 'POST',
                type: details.type,
                url: details.url,
                initiator: details.initiator || null,
                requestHeaders: details.requestHeaders || [],
                tabId: tabId,
                requestId: requestId,
            });
        }
    });
};

export const onBeforeRequest = (
    details: browser.WebRequest.OnBeforeRequestDetailsType,
) => {
    mutex.runExclusive(async () => {
        const { method, requestBody, tabId, requestId } = details;

        if (method === 'OPTIONS') return;

        if (requestBody) {
            const cache = getCacheByTabId(tabId);
            const existing = cache.get<RequestLog>(requestId);

            if (requestBody.raw && requestBody.raw[0]?.bytes) {
                try {
                    cache.set(requestId, {
                        ...existing,
                        requestBody: Buffer.from(requestBody.raw[0].bytes).toString(
                            'utf-8',
                        ),
                    });
                } catch (e) {
                    console.error(e);
                }
            } else if (requestBody.formData) {
                cache.set(requestId, {
                    ...existing,
                    formData: requestBody.formData,
                });
            }
        }
    });
};

export const onResponseStarted = (
    details: browser.WebRequest.OnResponseStartedDetailsType,
) => {
    mutex.runExclusive(async () => {
        const { method, responseHeaders, tabId, requestId } = details;

        if (method === 'OPTIONS') return;

        const cache = getCacheByTabId(tabId);

        const existing = cache.get<RequestLog>(requestId);
        const newLog: RequestLog = {
            requestHeaders: [],
            ...existing,
            method: details.method,
            type: details.type,
            url: details.url,
            initiator: details.initiator || null,
            tabId: tabId,
            requestId: requestId,
            responseHeaders,
        };

        cache.set(requestId, newLog);

        chrome.runtime.sendMessage({
            type: BackgroundActiontype.push_action,
            data: {
                tabId: details.tabId,
                request: newLog,
            },
            action: addRequest(newLog),
        });
    });
};

// hacky solution but see https://stackoverflow.com/q/60751095/3314063
// TODO see if you can utilize the request cache (see requests.ts and cache.ts)
// TODO note potential pitfall here if a request does not make it through onBeforeHeadersAutoNotarize
// then this cache will grow unbounded
const autoNotarizeRequestBodies: { [k: string]: string } = {};

export const onBeforeRequestStoreBody = (
    details: browser.WebRequest.OnBeforeRequestDetailsType,
): void => {
    if (!shouldAutoCapture(details)) return;

    const uploadData: browser.WebRequest.UploadData[] | undefined = details.requestBody?.raw;
    if ((uploadData !== null) && ((uploadData?.length ?? 0) > 0)) {
        // TODO not confident this is generally correct but see https://stackoverflow.com/q/60751095/3314063
        const rawBody: number[] = uploadData![0].bytes;
        const body: string = decodeURIComponent(String.fromCharCode.apply(null, rawBody));
        autoNotarizeRequestBodies[details.requestId] = body;
    }
}

export const onBeforeHeadersAutoNotarize = (
    req: browser.WebRequest.OnSendHeadersDetailsType,
): void => {
    if (!shouldAutoCapture(req)) return;

    autoNotarizeRequest(req).finally(() => delete autoNotarizeRequestBodies[req.requestId]);
}

// adapted from Home/index.tsx
const autoNotarizeRequest = async (
    req: browser.WebRequest.OnSendHeadersDetailsType,
): Promise<void> => {
    const hostname = urlify(req.url)?.hostname;

    const noteHeaders: { [k: string]: string } = req.requestHeaders?.reduce(
        (acc: any, h) => {
            acc[h.name] = h.value;
            return acc;
        },
        { Host: hostname },
    );

    //TODO: for some reason, these needs to be override to work
    noteHeaders['Accept-Encoding'] = 'identity';
    noteHeaders['Connection'] = 'close';

    const noteDetails = {
        url: req.url,
        method: req.method,
        headers: noteHeaders,
        body: autoNotarizeRequestBodies[req.requestId],
        maxTranscriptSize: MAX_TRANSCRIPT_SIZE,
        // TODO are there any secretHeaders or secretResps to include? see Home/index.tsx
    };
    const hydratedDetails = await notarizeRequest(noteDetails)();

    // TODO this should automatically happen as part of the initRpc message listeners intercepting
    // the message produced by notarizeRequest. However, it's not happening when called from the
    // here so I am forcing the next event stage
    await handleProveRequestStart({ type: BackgroundActiontype.prove_request_start, data: hydratedDetails }, () => null);
}

const shouldAutoCapture = (details: browser.WebRequest.OnSendHeadersDetailsType | browser.WebRequest.OnBeforeRequestDetailsType): boolean => {
    // A little redundant but the webRequest API filters dont let you filter by method
    return (details.method === "GET") && (details.type === "xmlhttprequest") && (details.url.includes('://api.twitter.com/1.1/account/settings.json'));
}