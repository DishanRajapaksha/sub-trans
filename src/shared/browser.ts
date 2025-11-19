const globalBrowser = (globalThis as typeof globalThis & { browser?: typeof chrome }).browser;

export const extensionBrowser: typeof chrome = globalBrowser ?? chrome;

export const isPromiseBasedBrowser = Boolean(globalBrowser);

export function sendRuntimeMessage<TMessage, TResponse = unknown>(
  message: TMessage
): Promise<TResponse> {
  if (isPromiseBasedBrowser) {
    return (extensionBrowser.runtime.sendMessage(message) as unknown) as Promise<TResponse>;
  }

  return new Promise<TResponse>((resolve, reject) => {
    extensionBrowser.runtime.sendMessage(message, (response) => {
      const error = extensionBrowser.runtime.lastError;
      if (error) {
        reject(error);
        return;
      }
      resolve(response as TResponse);
    });
  });
}
