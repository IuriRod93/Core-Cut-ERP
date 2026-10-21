import * as SecureStore from 'expo-secure-store'

const KEY = 'corecut.session.token'
const NAME = 'corecut.session.name'

/** A sessão fica no cofre do Android (Keystore), nunca em armazenamento comum. */
export const session = {
  async getToken() {
    try {
      return await SecureStore.getItemAsync(KEY)
    } catch {
      return null
    }
  },
  async setToken(token: string, name?: string) {
    await SecureStore.setItemAsync(KEY, token)
    if (name) await SecureStore.setItemAsync(NAME, name)
  },
  async getName() {
    try {
      return await SecureStore.getItemAsync(NAME)
    } catch {
      return null
    }
  },
  async clear() {
    try {
      await SecureStore.deleteItemAsync(KEY)
      await SecureStore.deleteItemAsync(NAME)
    } catch {
      /* já não existia */
    }
  },
}
