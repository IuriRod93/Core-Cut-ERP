import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, AppState, Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import * as Application from 'expo-application'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { api, ApiError, type LoginStart, type SessionPayload } from './src/api'
import { DOWNLOAD_PAGE, RELOCK_AFTER_MS, VERSION_URL } from './src/config'
import { session } from './src/session'
import { colors, radius } from './src/theme'
import { LoginScreen } from './src/screens/LoginScreen'
import { FaceScreen, type FaceMode } from './src/screens/FaceScreen'
import { ShellScreen } from './src/screens/ShellScreen'

type Stage =
  | { name: 'boot' }
  | { name: 'offline' }
  | { name: 'login'; notice?: string | null }
  | { name: 'face'; mode: Exclude<FaceMode, { kind: 'recheck' }>; who: string }
  | { name: 'lock'; token: string; who: string | null }
  | { name: 'shell'; token: string }

export default function App() {
  const [stage, setStage] = useState<Stage>({ name: 'boot' })
  const stageRef = useRef(stage)
  stageRef.current = stage
  const leftAt = useRef<number | null>(null)
  const [update, setUpdate] = useState<{ name: string } | null>(null)

  // há uma versão mais nova do aplicativo publicada no servidor? (checa sozinho ao abrir)
  useEffect(() => {
    let alive = true
    fetch(`${VERSION_URL}?t=${Date.now()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((info: { versionCode?: number; versionName?: string } | null) => {
        const mine = Number(Application.nativeBuildVersion ?? 0)
        if (alive && info?.versionCode && info.versionCode > mine) setUpdate({ name: info.versionName ?? String(info.versionCode) })
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  const toLogin = useCallback(async (notice?: string | null) => {
    await session.clear()
    setStage({ name: 'login', notice })
  }, [])

  // abertura: há sessão guardada? então só falta confirmar o rosto
  const boot = useCallback(async () => {
    setStage({ name: 'boot' })
    const token = await session.getToken()
    if (!token) return setStage({ name: 'login' })
    try {
      const status = await api.faceStatus(token)
      if (!status.enrolled) return void (await toLogin('O cadastro do seu rosto foi redefinido. Entre de novo para cadastrar.'))
      setStage({ name: 'lock', token, who: await session.getName() })
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) return setStage({ name: 'offline' })
      await toLogin('Sua sessão terminou. Entre de novo.')
    }
  }, [toLogin])

  useEffect(() => {
    void boot()
  }, [boot])

  // voltou do segundo plano depois de um tempo: pede o rosto de novo
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') {
        if (leftAt.current === null) leftAt.current = Date.now()
        return
      }
      const elapsed = leftAt.current === null ? 0 : Date.now() - leftAt.current
      leftAt.current = null
      const current = stageRef.current
      if (current.name === 'shell' && elapsed > RELOCK_AFTER_MS) setStage({ name: 'lock', token: current.token, who: null })
    })
    return () => sub.remove()
  }, [])

  const onStart = (start: LoginStart) => {
    setStage({
      name: 'face',
      who: start.name,
      mode: start.enrolled ? { kind: 'verify', ticket: start.ticket } : { kind: 'enroll', ticket: start.ticket },
    })
  }

  const onSession = async (payload: SessionPayload) => {
    await session.setToken(payload.token, String(payload.user?.name ?? '').split(/\s+/)[0])
    setStage({ name: 'shell', token: payload.token })
  }

  let screen
  if (stage.name === 'boot') {
    screen = (
      <View style={styles.center}>
        <Image source={require('./assets/logo-mark.png')} style={styles.mark} />
        <ActivityIndicator color={colors.brand} style={{ marginTop: 18 }} />
      </View>
    )
  } else if (stage.name === 'offline') {
    screen = (
      <View style={styles.center}>
        <Text style={styles.title}>Sem conexão</Text>
        <Text style={styles.text}>Confira a internet para abrir o Core Cut.</Text>
        <Pressable style={styles.button} onPress={() => void boot()}>
          <Text style={styles.buttonText}>Tentar de novo</Text>
        </Pressable>
      </View>
    )
  } else if (stage.name === 'login') {
    screen = <LoginScreen onStart={onStart} notice={stage.notice} />
  } else if (stage.name === 'face') {
    screen = (
      <FaceScreen
        key={stage.mode.ticket}
        mode={stage.mode}
        name={stage.who}
        onCancel={() => setStage({ name: 'login' })}
        onSuccess={(payload) => payload && void onSession(payload)}
      />
    )
  } else if (stage.name === 'lock') {
    screen = (
      <FaceScreen
        mode={{ kind: 'recheck', token: stage.token }}
        name={stage.who}
        onCancel={() => {
          void api.logout(stage.token)
          void toLogin()
        }}
        onSuccess={() => setStage({ name: 'shell', token: stage.token })}
      />
    )
  } else {
    screen = (
      <ShellScreen
        token={stage.token}
        onLogout={() => {
          void api.logout(stage.token)
          void toLogin()
        }}
      />
    )
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <StatusBar style="dark" />
        {update ? (
          <Pressable style={styles.update} onPress={() => void Linking.openURL(DOWNLOAD_PAGE)} accessibilityRole="button">
            <Text style={styles.updateText}>Nova versão {update.name} disponível. Toque para atualizar.</Text>
          </Pressable>
        ) : null}
        {screen}
      </SafeAreaView>
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#ffffff' },
  update: { backgroundColor: colors.brand, paddingVertical: 10, paddingHorizontal: 14 },
  updateText: { color: '#fff', fontSize: 14, fontWeight: '600', textAlign: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 8 },
  mark: { width: 96, height: 96 },
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  text: { fontSize: 15, color: colors.textSecondary, textAlign: 'center' },
  button: { marginTop: 14, backgroundColor: colors.brand, borderRadius: radius.button, paddingVertical: 14, paddingHorizontal: 28 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
})
