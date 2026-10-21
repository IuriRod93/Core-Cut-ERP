import { useRef, useState } from 'react'
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as Application from 'expo-application'
import * as Device from 'expo-device'
import { api, ApiError, pingServer, type LoginStart } from '../api'
import { FORGOT_URL, SIGNUP_URL } from '../config'
import { colors, radius } from '../theme'

/** Tela inicial: igual à do sistema (logo, "Acessar o ERP", usuário e senha, Entrar, Esqueci minha senha, Cadastro). */
export function LoginScreen({ onStart, notice }: { onStart: (start: LoginStart, login: string) => void; notice?: string | null }) {
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<string | null>(null)
  const [ping, setPing] = useState<{ ok: boolean; text: string } | null>(null)
  const [pinging, setPinging] = useState(false)
  const passwordRef = useRef<TextInput>(null)

  const submit = async () => {
    if (busy) return
    if (!login.trim() || !password) {
      setError('Informe o usuário e a senha.')
      return
    }
    setBusy(true)
    setError(null)
    setDetail(null)
    try {
      const start = await api.login(login.trim(), password, {
        name: Device.modelName ?? 'Android',
        platform: `Android ${Device.osVersion ?? ''}`.trim(),
        version: Application.nativeApplicationVersion ?? '1.0.0',
      })
      setPassword('')
      onStart(start, login.trim())
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível entrar agora.')
      if (e instanceof ApiError && e.detail) setDetail(e.detail)
    } finally {
      setBusy(false)
    }
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.brand}>
          <Image source={require('../../assets/logo-mark.png')} style={styles.mark} />
          <View>
            <Text style={styles.brandName}>CORE CUT</Text>
            <Text style={styles.brandSub}>ERP</Text>
          </View>
        </View>

        <Text style={styles.title}>Acessar o ERP</Text>
        <Text style={styles.subtitle}>Entre com seu usuário e senha para continuar.</Text>

        {notice ? (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>{notice}</Text>
          </View>
        ) : null}

        <View style={styles.field}>
          <Text style={styles.label}>Usuário ou e-mail *</Text>
          <TextInput
            style={styles.input}
            value={login}
            onChangeText={setLogin}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            keyboardType="email-address"
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
            editable={!busy}
            accessibilityLabel="Usuário ou e-mail"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Senha *</Text>
          <View style={styles.passwordRow}>
            <TextInput
              ref={passwordRef}
              style={[styles.input, styles.passwordInput]}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!show}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="current-password"
              returnKeyType="go"
              onSubmitEditing={submit}
              editable={!busy}
              accessibilityLabel="Senha"
            />
            <Pressable style={styles.eye} onPress={() => setShow((v) => !v)} accessibilityLabel={show ? 'Ocultar senha' : 'Mostrar senha'} hitSlop={10}>
              <Ionicons name={show ? 'eye-off-outline' : 'eye-outline'} size={22} color={colors.textSecondary} />
            </Pressable>
          </View>
        </View>

        {error ? (
          <View style={styles.error}>
            <Text style={styles.errorText}>{error}</Text>
            {detail ? <Text style={styles.detailText}>{detail}</Text> : null}
          </View>
        ) : null}

        <Pressable style={({ pressed }) => [styles.primary, (pressed || busy) && { opacity: 0.85 }]} onPress={submit} disabled={busy} accessibilityRole="button">
          {busy ? <ActivityIndicator color="#fff" /> : <Ionicons name="lock-closed" size={20} color="#fff" />}
          <Text style={styles.primaryText}>{busy ? 'Entrando…' : 'Entrar'}</Text>
        </Pressable>

        <Pressable onPress={() => void Linking.openURL(FORGOT_URL)} style={styles.link} hitSlop={8}>
          <Text style={styles.linkText}>Esqueci minha senha</Text>
        </Pressable>

        <Pressable style={({ pressed }) => [styles.secondary, pressed && { backgroundColor: colors.subtle }]} onPress={() => void Linking.openURL(SIGNUP_URL)} accessibilityRole="button">
          <Text style={styles.secondaryText}>Cadastro de empresas</Text>
        </Pressable>

        <Pressable
          style={styles.link}
          hitSlop={8}
          onPress={async () => {
            setPinging(true)
            setPing(null)
            setPing(await pingServer())
            setPinging(false)
          }}
        >
          <Text style={styles.pingText}>{pinging ? 'Testando…' : 'Testar conexão com o servidor'}</Text>
        </Pressable>
        {ping ? <Text style={[styles.pingResult, { color: ping.ok ? colors.success : colors.danger }]}>{ping.text}</Text> : null}

        <Text style={styles.foot}>Novo por aqui? O cadastro abre no navegador e você testa grátis por 48 horas.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 22, paddingVertical: 32 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 56 },
  mark: { width: 44, height: 44 },
  brandName: { fontSize: 20, fontWeight: '700', letterSpacing: 1.5, color: colors.navy },
  brandSub: { fontSize: 11, fontWeight: '700', letterSpacing: 2, color: colors.brand, marginTop: -2 },
  title: { fontSize: 30, fontWeight: '700', color: colors.text, marginBottom: 6 },
  subtitle: { fontSize: 16, color: colors.textSecondary, marginBottom: 22 },
  notice: { backgroundColor: colors.brandTint, borderRadius: radius.field, padding: 12, marginBottom: 14 },
  noticeText: { color: colors.brandDark, fontSize: 14 },
  field: { marginBottom: 16 },
  label: { fontSize: 13, color: colors.brand, marginBottom: 6, marginLeft: 4 },
  input: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.field,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 17,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  passwordRow: { justifyContent: 'center' },
  passwordInput: { paddingRight: 48 },
  eye: { position: 'absolute', right: 14 },
  error: { backgroundColor: '#fdecea', borderRadius: radius.field, padding: 12, marginBottom: 12 },
  errorText: { color: colors.danger, fontSize: 14 },
  detailText: { color: colors.textMuted, fontSize: 11, marginTop: 6 },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: colors.brand,
    borderRadius: radius.button,
    paddingVertical: 17,
    marginTop: 4,
  },
  primaryText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  link: { alignSelf: 'center', paddingVertical: 20 },
  linkText: { color: colors.brand, fontSize: 16, fontWeight: '600' },
  secondary: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.button,
    paddingVertical: 17,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  secondaryText: { color: colors.text, fontSize: 17, fontWeight: '600' },
  pingText: { color: colors.textMuted, fontSize: 13, textDecorationLine: 'underline' },
  pingResult: { textAlign: 'center', fontSize: 13, marginBottom: 6 },
  foot: { textAlign: 'center', color: colors.textMuted, fontSize: 13, marginTop: 18, lineHeight: 18 },
})
