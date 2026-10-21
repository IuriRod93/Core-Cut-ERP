import { useRef, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator'
import { Ionicons } from '@expo/vector-icons'
import { api, ApiError, type SessionPayload } from '../api'
import { colors, radius } from '../theme'

export type FaceMode =
  | { kind: 'enroll'; ticket: string }
  | { kind: 'verify'; ticket: string }
  | { kind: 'recheck'; token: string }

const COPY = {
  enroll: {
    title: 'Cadastre o seu rosto',
    text: 'O rosto confirma que é você sempre que entrar no aplicativo. Fique de frente, com boa luz e sem óculos escuros.',
    button: 'Cadastrar rosto',
  },
  verify: {
    title: 'Confirme que é você',
    text: 'Centralize o rosto no círculo e toque em verificar.',
    button: 'Verificar rosto',
  },
  recheck: {
    title: 'Confirme que é você',
    text: 'Por segurança, confirme o rosto para continuar usando o Core Cut.',
    button: 'Verificar rosto',
  },
} as const

const CONSENT =
  'Autorizo o Core Cut a guardar uma foto e a "assinatura matemática" do meu rosto, cifradas, só para confirmar que sou eu ao entrar no aplicativo. Posso pedir a exclusão ao administrador a qualquer momento.'

/** Etapa do rosto: cadastro (primeiro acesso), verificação (depois da senha) ou nova checagem ao reabrir. */
export function FaceScreen({
  mode,
  name,
  onSuccess,
  onCancel,
}: {
  mode: FaceMode
  name?: string | null
  onSuccess: (session: SessionPayload | null) => void
  onCancel: () => void
}) {
  const [permission, requestPermission] = useCameraPermissions()
  const camera = useRef<CameraView>(null)
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const copy = COPY[mode.kind]
  const enroll = mode.kind === 'enroll'

  const capture = async (): Promise<string> => {
    const photo = await camera.current?.takePictureAsync({ quality: 0.7, skipProcessing: false })
    if (!photo?.uri) throw new Error('A câmera não devolveu a foto.')
    // reduz para ~640 px de largura: leve para enviar e suficiente para o reconhecimento
    const small = await manipulateAsync(photo.uri, [{ resize: { width: 640 } }], { compress: 0.7, format: SaveFormat.JPEG, base64: true })
    if (!small.base64) throw new Error('Não foi possível preparar a foto.')
    return small.base64
  }

  const submit = async () => {
    if (busy || !ready) return
    if (enroll && !consent) {
      setError('Marque a autorização para cadastrar o rosto.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const image = await capture()
      if (mode.kind === 'enroll') onSuccess(await api.enroll(mode.ticket, image, { consent }))
      else if (mode.kind === 'verify') onSuccess(await api.verify(mode.ticket, image))
      else {
        await api.recheck(mode.token, image)
        onSuccess(null)
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401 && mode.kind !== 'recheck') {
        // tíquete vencido ou esgotado: volta para a senha
        setError(e.message)
        if (/expirou|esgot/i.test(e.message) || /Entre de novo/i.test(e.message)) setTimeout(onCancel, 1800)
      } else setError(e instanceof Error ? e.message : 'Não foi possível verificar agora.')
    } finally {
      setBusy(false)
    }
  }

  if (!permission) return <View style={styles.root} />
  if (!permission.granted) {
    return (
      <View style={[styles.root, styles.center]}>
        <Ionicons name="camera-outline" size={56} color={colors.brand} />
        <Text style={styles.title}>Precisamos da câmera</Text>
        <Text style={styles.text}>A câmera é usada só para confirmar o seu rosto ao entrar.</Text>
        <Pressable style={styles.primary} onPress={() => void requestPermission()}>
          <Text style={styles.primaryText}>Permitir câmera</Text>
        </Pressable>
        <Pressable onPress={onCancel} style={styles.link}>
          <Text style={styles.linkText}>Voltar</Text>
        </Pressable>
      </View>
    )
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>{name ? `${copy.title}, ${name}` : copy.title}</Text>
      <Text style={styles.text}>{copy.text}</Text>

      <View style={styles.cameraWrap}>
        <CameraView ref={camera} style={styles.camera} facing="front" mirror onCameraReady={() => setReady(true)} />
        <View pointerEvents="none" style={styles.oval} />
        {!ready ? (
          <View style={styles.cameraLoading}>
            <ActivityIndicator color="#fff" />
          </View>
        ) : null}
      </View>

      {enroll ? (
        <>
          <Pressable style={styles.consentRow} onPress={() => setConsent((v) => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: consent }}>
            <Ionicons name={consent ? 'checkbox' : 'square-outline'} size={24} color={consent ? colors.brand : colors.textSecondary} />
            <Text style={styles.consent}>{CONSENT}</Text>
          </Pressable>
        </>
      ) : null}

      {error ? (
        <View style={styles.error}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <Pressable style={({ pressed }) => [styles.primary, (pressed || busy || !ready) && { opacity: 0.8 }]} onPress={submit} disabled={busy || !ready} accessibilityRole="button">
        {busy ? <ActivityIndicator color="#fff" /> : <Ionicons name="scan-outline" size={22} color="#fff" />}
        <Text style={styles.primaryText}>{busy ? 'Verificando…' : copy.button}</Text>
      </Pressable>

      <Pressable onPress={onCancel} style={styles.link} hitSlop={8}>
        <Text style={styles.linkText}>{mode.kind === 'recheck' ? 'Entrar com outra conta' : 'Voltar'}</Text>
      </Pressable>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { alignItems: 'center', justifyContent: 'center', padding: 28, gap: 12 },
  scroll: { padding: 22, paddingTop: 48 },
  title: { fontSize: 26, fontWeight: '700', color: colors.text, marginBottom: 8, textAlign: 'center' },
  text: { fontSize: 15, color: colors.textSecondary, textAlign: 'center', marginBottom: 18, lineHeight: 21 },
  cameraWrap: { alignSelf: 'center', width: 280, height: 360, borderRadius: 20, overflow: 'hidden', backgroundColor: '#000', marginBottom: 18 },
  camera: { flex: 1 },
  oval: {
    position: 'absolute',
    left: 30,
    right: 30,
    top: 40,
    bottom: 60,
    borderRadius: 140,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.9)',
    borderStyle: 'dashed',
  },
  cameraLoading: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)' },
  codeBox: { marginBottom: 12 },
  label: { fontSize: 13, color: colors.brand, marginBottom: 6, marginLeft: 4 },
  input: { borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.field, padding: 14, fontSize: 18, letterSpacing: 4, textAlign: 'center', color: colors.text },
  consentRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginBottom: 14 },
  consent: { flex: 1, fontSize: 13, color: colors.textSecondary, lineHeight: 18 },
  error: { backgroundColor: '#fdecea', borderRadius: radius.field, padding: 12, marginBottom: 12 },
  errorText: { color: colors.danger, fontSize: 14, textAlign: 'center' },
  primary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: colors.brand, borderRadius: radius.button, paddingVertical: 17, paddingHorizontal: 24 },
  primaryText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  link: { alignSelf: 'center', paddingVertical: 18 },
  linkText: { color: colors.brand, fontSize: 16, fontWeight: '600' },
})
