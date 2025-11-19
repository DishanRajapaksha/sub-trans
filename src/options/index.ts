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

export class OptionsPage {
  constructor(
    private formEl: HTMLFormElement | null,
    private statusEl: HTMLElement | null
  ) { }

  renderStatus(message: string, isError = false): void {
    if (!this.statusEl) {
      return;
    }

    this.statusEl.textContent = message;
    this.statusEl.dataset.state = isError ? 'error' : 'success';
  }

  populateForm(values: OptionsFormValues): void {
    if (!this.formEl) {
      return;
    }

    Object.entries(values).forEach(([key, value]) => {
      if (typeof value !== 'string') {
        return;
      }

      const input = this.formEl!.querySelector<HTMLInputElement | HTMLSelectElement>(
        `[name="${key}"]`
      );
      if (input) {
        input.value = value;
      }
    });
  }

  readFormValues(): OptionsFormValues | null {
    if (!this.formEl) {
      return null;
    }

    const formData = new FormData(this.formEl);
    const providerInput = String(formData.get('provider') ?? '').trim();
    const apiBaseUrl = String(formData.get('apiBaseUrl') ?? '').trim();
    const apiKey = String(formData.get('apiKey') ?? '').trim();
    const model = String(formData.get('model') ?? '').trim();

    if (!isSupportedProvider(providerInput)) {
      this.renderStatus('Provider is required', true);
      return null;
    }

    return { provider: providerInput, apiBaseUrl, apiKey, model };
  }

  async handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const values = this.readFormValues();
    if (!values) {
      return;
    }

    try {
      await setSyncStorage(values);
      this.renderStatus('Saved translation preferences');
    } catch (error) {
      this.renderStatus(`Failed to save options: ${String(error)}`, true);
    }
  }

  async init(): Promise<void> {
    if (!this.formEl) {
      return;
    }

    this.formEl.addEventListener('submit', (event) => {
      void this.handleSubmit(event);
    });

    try {
      const values = await getSyncStorage();
      this.populateForm(values);
    } catch (error) {
      this.renderStatus(`Unable to load saved options: ${String(error)}`, true);
    }
  }
}

const statusEl = document.querySelector<HTMLElement>('[data-status]');
const formEl = document.querySelector<HTMLFormElement>('#options-form');
const page = new OptionsPage(formEl, statusEl);
void page.init();
