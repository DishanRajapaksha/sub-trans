import { extensionBrowser } from '../shared/browser';
import {
  DEFAULT_TRANSLATION_SETTINGS,
  SUPPORTED_TRANSLATION_PROVIDERS,
  type TranslationSettings
} from '../shared/translation-settings';

type OptionsFormValues = TranslationSettings;

const DEFAULT_OPTIONS: OptionsFormValues = { ...DEFAULT_TRANSLATION_SETTINGS };

const isSupportedProvider = (value: string): value is OptionsFormValues['provider'] => {
  return SUPPORTED_TRANSLATION_PROVIDERS.includes(value as OptionsFormValues['provider']);
};

const getSyncStorage = async (): Promise<OptionsFormValues> => {
  return new Promise((resolve, reject) => {
    const storageArea = extensionBrowser.storage.sync ?? extensionBrowser.storage.local;
    storageArea.get(DEFAULT_OPTIONS, (items) => {
      const error = extensionBrowser.runtime.lastError;
      if (error) {
        reject(error);
        return;
      }
      resolve(items as OptionsFormValues);
    });
  });
};

const setSyncStorage = async (values: OptionsFormValues): Promise<void> => {
  return new Promise((resolve, reject) => {
    const storageArea = extensionBrowser.storage.sync ?? extensionBrowser.storage.local;
    storageArea.set(values, () => {
      const error = extensionBrowser.runtime.lastError;
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
};

const statusEl = document.querySelector<HTMLElement>('[data-status]');
const formEl = document.querySelector<HTMLFormElement>('#options-form');

const renderStatus = (message: string, isError = false): void => {
  if (!statusEl) {
    return;
  }

  statusEl.textContent = message;
  statusEl.dataset.state = isError ? 'error' : 'success';
};

const populateForm = (values: OptionsFormValues): void => {
  if (!formEl) {
    return;
  }

  Object.entries(values).forEach(([key, value]) => {
    if (typeof value !== 'string') {
      return;
    }

    const input = formEl.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${key}"]`);
    if (input) {
      input.value = value;
    }
  });
};

const readFormValues = (): OptionsFormValues | null => {
  if (!formEl) {
    return null;
  }

  const formData = new FormData(formEl);
  const providerInput = String(formData.get('provider') ?? '').trim();
  const apiBaseUrl = String(formData.get('apiBaseUrl') ?? '').trim();
  const apiKey = String(formData.get('apiKey') ?? '').trim();
  const model = String(formData.get('model') ?? '').trim();

  if (!isSupportedProvider(providerInput)) {
    renderStatus('Provider is required', true);
    return null;
  }

  return { provider: providerInput, apiBaseUrl, apiKey, model };
};

const handleSubmit = async (event: SubmitEvent): Promise<void> => {
  event.preventDefault();
  const values = readFormValues();
  if (!values) {
    return;
  }

  try {
    await setSyncStorage(values);
    renderStatus('Saved translation preferences');
  } catch (error) {
    renderStatus(`Failed to save options: ${String(error)}`, true);
  }
};

const init = async (): Promise<void> => {
  if (!formEl) {
    return;
  }

  formEl.addEventListener('submit', (event) => {
    void handleSubmit(event);
  });

  try {
    const values = await getSyncStorage();
    populateForm(values);
  } catch (error) {
    renderStatus(`Unable to load saved options: ${String(error)}`, true);
  }
};

void init();
