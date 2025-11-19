import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DEFAULT_TRANSLATION_SETTINGS } from '../src/shared/translation-settings';
import { OptionsPage } from '../src/options/index';

// Mock the browser module
const mocks = vi.hoisted(() => ({
    storageGet: vi.fn(),
    storageSet: vi.fn(),
    runtimeLastError: vi.fn(),
    useSync: { value: true }
}));

vi.mock('../src/shared/browser', () => ({
    extensionBrowser: {
        get storage() {
            return {
                get sync() {
                    return mocks.useSync.value
                        ? { get: mocks.storageGet, set: mocks.storageSet }
                        : undefined;
                },
                local: {
                    get: mocks.storageGet,
                    set: mocks.storageSet,
                }
            };
        },
        runtime: {
            get lastError() {
                return mocks.runtimeLastError();
            },
        },
    },
}));

describe('Options Page', () => {
    beforeEach(() => {
        // Reset mocks
        vi.clearAllMocks();
        mocks.runtimeLastError.mockReturnValue(undefined);
        mocks.useSync.value = true;

        // Set up DOM
        document.body.innerHTML = `
      <div data-status></div>
      <form id="options-form">
        <select name="provider">
          <option value="openai">OpenAI</option>
          <option value="mistral">Mistral</option>
        </select>
        <input name="apiBaseUrl" />
        <input name="apiKey" />
        <input name="model" />
        <button type="submit">Save</button>
      </form>
    `;
    });

    afterEach(() => {
        vi.resetModules();
        document.body.innerHTML = '';
    });

    it('loads settings from storage on init', async () => {
        const settings = { ...DEFAULT_TRANSLATION_SETTINGS, apiKey: 'test-key', provider: 'mistral' };
        mocks.storageGet.mockImplementation((defaults, callback) => {
            callback(settings);
        });

        const form = document.querySelector('form') as HTMLFormElement;
        const status = document.querySelector('[data-status]') as HTMLElement;
        const optionsPage = new OptionsPage(form, status);
        await optionsPage.init();

        // Wait for async operations
        await new Promise(resolve => setTimeout(resolve, 0));

        const apiKeyInput = document.querySelector<HTMLInputElement>('[name="apiKey"]');
        const providerSelect = document.querySelector<HTMLSelectElement>('[name="provider"]');

        expect(apiKeyInput?.value).toBe('test-key');
        expect(providerSelect?.value).toBe('mistral');
    });

    it('falls back to local storage if sync is undefined', async () => {
        mocks.useSync.value = false;
        const settings = { ...DEFAULT_TRANSLATION_SETTINGS, apiKey: 'local-key' };
        mocks.storageGet.mockImplementation((defaults, callback) => {
            callback(settings);
        });

        const form = document.querySelector('form') as HTMLFormElement;
        const status = document.querySelector('[data-status]') as HTMLElement;
        const optionsPage = new OptionsPage(form, status);
        await optionsPage.init();
        await new Promise(resolve => setTimeout(resolve, 0));

        const apiKeyInput = document.querySelector<HTMLInputElement>('[name="apiKey"]');
        expect(apiKeyInput?.value).toBe('local-key');
    });

    it('handles storage error on load', async () => {
        mocks.storageGet.mockImplementation((defaults, callback) => {
            mocks.runtimeLastError.mockReturnValue({ message: 'Storage error' });
            callback({});
        });

        const form = document.querySelector('form') as HTMLFormElement;
        const status = document.querySelector('[data-status]') as HTMLElement;
        const optionsPage = new OptionsPage(form, status);
        await optionsPage.init();
        await new Promise(resolve => setTimeout(resolve, 0));

        const statusEl = document.querySelector('[data-status]');
        expect(statusEl?.textContent).toContain('Unable to load saved options');
        expect(statusEl?.getAttribute('data-state')).toBe('error');
    });

    it('saves settings on submit', async () => {
        mocks.storageGet.mockImplementation((defaults, callback) => {
            callback(DEFAULT_TRANSLATION_SETTINGS);
        });
        mocks.storageSet.mockImplementation((items, callback) => {
            callback();
        });

        const form = document.querySelector('form') as HTMLFormElement;
        const status = document.querySelector('[data-status]') as HTMLElement;
        const optionsPage = new OptionsPage(form, status);
        await optionsPage.init();
        await new Promise(resolve => setTimeout(resolve, 0));

        const apiKeyInput = document.querySelector<HTMLInputElement>('[name="apiKey"]')!;
        apiKeyInput.value = 'new-key';

        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

        await new Promise(resolve => setTimeout(resolve, 0));

        expect(mocks.storageSet).toHaveBeenCalledWith(
            expect.objectContaining({ apiKey: 'new-key' }),
            expect.any(Function)
        );

        const statusEl = document.querySelector('[data-status]');
        expect(statusEl?.textContent).toContain('Saved translation preferences');
        expect(statusEl?.getAttribute('data-state')).toBe('success');
    });

    it('saves to local storage if sync is undefined', async () => {
        mocks.useSync.value = false;
        mocks.storageGet.mockImplementation((defaults, callback) => {
            callback(DEFAULT_TRANSLATION_SETTINGS);
        });
        mocks.storageSet.mockImplementation((items, callback) => {
            callback();
        });

        const form = document.querySelector('form') as HTMLFormElement;
        const status = document.querySelector('[data-status]') as HTMLElement;
        const optionsPage = new OptionsPage(form, status);
        await optionsPage.init();
        await new Promise(resolve => setTimeout(resolve, 0));

        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(mocks.storageSet).toHaveBeenCalled();
    });

    it('handles storage error on save', async () => {
        mocks.storageGet.mockImplementation((defaults, callback) => {
            callback(DEFAULT_TRANSLATION_SETTINGS);
        });
        mocks.storageSet.mockImplementation((items, callback) => {
            mocks.runtimeLastError.mockReturnValue({ message: 'Save error' });
            callback();
        });

        const form = document.querySelector('form') as HTMLFormElement;
        const status = document.querySelector('[data-status]') as HTMLElement;
        const optionsPage = new OptionsPage(form, status);
        await optionsPage.init();
        await new Promise(resolve => setTimeout(resolve, 0));

        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

        await new Promise(resolve => setTimeout(resolve, 0));

        const statusEl = document.querySelector('[data-status]');
        expect(statusEl?.textContent).toContain('Failed to save options');
        expect(statusEl?.getAttribute('data-state')).toBe('error');
    });

    it('validates provider on submit', async () => {
        mocks.storageGet.mockImplementation((defaults, callback) => {
            callback(DEFAULT_TRANSLATION_SETTINGS);
        });

        const form = document.querySelector('form') as HTMLFormElement;
        const status = document.querySelector('[data-status]') as HTMLElement;
        const optionsPage = new OptionsPage(form, status);
        await optionsPage.init();
        await new Promise(resolve => setTimeout(resolve, 0));

        const providerSelect = document.querySelector<HTMLSelectElement>('[name="provider"]')!;

        // Add an invalid option and select it
        const option = document.createElement('option');
        option.value = 'invalid';
        providerSelect.add(option);
        providerSelect.value = 'invalid';

        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

        await new Promise(resolve => setTimeout(resolve, 0));

        const statusEl = document.querySelector('[data-status]');
        expect(statusEl?.textContent).toContain('Provider is required');
        expect(statusEl?.getAttribute('data-state')).toBe('error');
        expect(mocks.storageSet).not.toHaveBeenCalled();
    });

    it('does nothing if form element is missing', async () => {
        document.body.innerHTML = ''; // No form

        // Instantiate with null form and a dummy status element
        const status = document.createElement('div');
        const optionsPage = new OptionsPage(null, status);
        await optionsPage.init();
        await new Promise(resolve => setTimeout(resolve, 0));

        // Should not crash and storage.get should not have been called
        expect(mocks.storageGet).not.toHaveBeenCalled();
    });

    describe('Edge cases', () => {
        it('does not crash if status element is missing', () => {
            const page = new OptionsPage(document.createElement('form'), null);
            page.renderStatus('test');
            // Should not throw
        });

        it('does not crash if form element is missing', () => {
            const page = new OptionsPage(null, document.createElement('div'));
            page.populateForm(DEFAULT_TRANSLATION_SETTINGS);
            expect(page.readFormValues()).toBeNull();
            // Should not throw
        });

        it('ignores non-string values in populateForm', () => {
            const form = document.createElement('form');
            const input = document.createElement('input');
            input.name = 'apiKey';
            form.appendChild(input);

            const page = new OptionsPage(form, null);
            // @ts-expect-error Testing invalid runtime data
            page.populateForm({ apiKey: 123 });

            expect(input.value).toBe('');
        });

        it('ignores unknown keys in populateForm', () => {
            const form = document.createElement('form');
            const page = new OptionsPage(form, null);
            // @ts-expect-error Testing extra keys
            page.populateForm({ unknownKey: 'value' });
            // Should not throw
        });

        it('handles missing provider input in readFormValues', () => {
            const form = document.createElement('form');
            // No inputs
            const page = new OptionsPage(form, null);
            const values = page.readFormValues();
            expect(values).toBeNull();
        });
    });
});
