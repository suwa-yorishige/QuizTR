/** OneDriveへの手動バックアップを管理するクラス。 */
class OneDriveManager {
    constructor(app) {
        this.app = app;
        this.account = null;
        this.msalInstance = null;
        this.initialized = false;
        this.busy = false;
        this.config = this.loadConfig();
    }

    loadConfig() {
        return {
            clientId: localStorage.getItem('quiz_onedrive_clientid') || '',
            authority: localStorage.getItem('quiz_onedrive_authority') || 'common'
        };
    }

    reloadConfiguration() {
        this.config = this.loadConfig();
        this.msalInstance = null;
        this.account = null;
        this.initialized = false;
    }

    isConfigured() {
        return Boolean(this.config.clientId && this.config.clientId !== 'YOUR_CLIENT_ID');
    }

    async initialize() {
        if (!this.isConfigured()) return false;
        if (!window.msal) throw new Error('OneDrive連携の認証ライブラリを読み込めませんでした');
        this.msalInstance = new msal.PublicClientApplication({
            auth: {
                clientId: this.config.clientId,
                authority: `https://login.microsoftonline.com/${this.config.authority || 'common'}`,
                redirectUri: this.config.redirectUri || window.location.origin + window.location.pathname
            },
            cache: { cacheLocation: 'sessionStorage' }
        });
        await this.msalInstance.initialize();
        const result = await this.msalInstance.handleRedirectPromise();
        if (result?.account) this.msalInstance.setActiveAccount(result.account);
        this.account = result?.account || this.msalInstance.getActiveAccount() || null;
        this.initialized = true;
        return Boolean(this.account);
    }

    async signIn() {
        this.ensureConfigured();
        if (!this.initialized) await this.initialize();
        if (this.account) return this.account;
        try {
            await this.msalInstance.loginRedirect({ scopes: ['Files.ReadWrite.AppFolder'], prompt: 'select_account' });
            return null;
        } catch (error) {
            if (error && error.errorCode === 'user_cancelled') throw new Error('Microsoftアカウントへのログインがキャンセルされました');
            throw this.normalizeError(error);
        }
    }

    async signOut() {
        if (!this.msalInstance || !this.account) return;
        await this.msalInstance.logoutRedirect({ account: this.account });
        this.account = null;
    }

    ensureConfigured() {
        if (!this.isConfigured()) throw new Error('OneDrive連携の設定が未完了です。管理者にclient IDの設定を依頼してください');
    }

    async getAccessToken() {
        this.ensureConfigured();
        if (!this.initialized) await this.initialize();
        if (!this.account) await this.signIn();
        try {
            const result = await this.msalInstance.acquireTokenSilent({
                account: this.account,
                scopes: ['Files.ReadWrite.AppFolder']
            });
            return result.accessToken;
        } catch (error) {
            if (error && (error.name === 'InteractionRequiredAuthError' || error.errorCode === 'interaction_required')) {
                await this.msalInstance.acquireTokenRedirect({ scopes: ['Files.ReadWrite.AppFolder'] });
                return null;
            }
            throw this.normalizeError(error);
        }
    }

    async request(path, options = {}) {
        const token = await this.getAccessToken();
        let response;
        try {
            response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
                ...options,
                headers: {
                    Authorization: `Bearer ${token}`,
                    ...options.headers
                }
            });
        } catch (error) {
            throw new Error('OneDriveとの通信に失敗しました');
        }
        if (!response.ok) {
            const error = new Error(`Graph API error: ${response.status}`);
            error.status = response.status;
            throw this.normalizeError(error);
        }
        return response;
    }

    async getAppFolder() {
        return this.request('/me/drive/special/approot');
    }

    async uploadStudySet(payload) {
        const set = payload.studySet;
        if (!set || !set.id) throw new Error('保存対象の学習セットが見つかりません');
        const fileName = `studyset_${set.id}.json`;
        const body = JSON.stringify(payload, null, 2);
        return this.request(`/me/drive/special/approot:/${encodeURIComponent(fileName)}:/content`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body
        });
    }

    async getStudySetList() {
        const response = await this.request('/me/drive/special/approot/children?$select=id,name,lastModifiedDateTime,file');
        const data = await response.json();
        return (data.value || [])
            .filter(item => item.file && /^studyset_.+\.json$/i.test(item.name))
            .map(item => ({ id: item.id, fileName: item.name, modifiedDate: item.lastModifiedDateTime }));
    }

    async downloadStudySet(fileId) {
        const response = await this.request(`/me/drive/items/${encodeURIComponent(fileId)}/content`);
        try {
            return JSON.parse(await response.text());
        } catch (error) {
            throw new Error('バックアップファイルが不正です');
        }
    }

    normalizeError(error) {
        if (error instanceof Error && error.message !== `Graph API error: ${error.status}`) return error;
        if (error.status === 401) return new Error('Microsoftアカウントへ再ログインしてください');
        if (error.status === 403) return new Error('OneDriveへのアクセス権限がありません');
        if (error.status === 429 || error.status >= 500) return new Error('OneDriveとの通信に失敗しました。時間をおいて再試行してください');
        return new Error('OneDriveとの通信に失敗しました');
    }
}
