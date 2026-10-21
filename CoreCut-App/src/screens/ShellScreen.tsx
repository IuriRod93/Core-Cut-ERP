import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Alert, BackHandler, Linking, PermissionsAndroid, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import { APP_UA, BASE_URL, HOME_PATH } from '../config'
import { colors, radius } from '../theme'

/**
 * O sistema completo (mesmas telas, permissões e regras do site) dentro do aplicativo.
 * A entrada, o rosto e a sessão são nativos; o que o usuário vê depois do login é o próprio Core Cut,
 * então toda função nova do site aparece no aplicativo sem precisar reinstalar.
 */
const HOST = new URL(BASE_URL).host

// roda antes do site carregar: entrega a sessão, liga a ponte de downloads e avisa quando o site sai da conta
const bridge = (token: string) => `
(function () {
  try {
    localStorage.setItem('arcoplan.token', ${JSON.stringify(token)});
    localStorage.setItem('core-cut-erp.install-onboarding-dismissed', 'dismissed');
  } catch (e) {}
  var post = function (o) { window.ReactNativeWebView.postMessage(JSON.stringify(o)); };
  var originalClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    var a = this;
    if (a.download && /^blob:/.test(a.href)) {
      fetch(a.href).then(function (r) { return r.blob(); }).then(function (b) {
        var reader = new FileReader();
        reader.onload = function () {
          var s = String(reader.result);
          post({ type: 'download', name: a.download, mime: b.type, base64: s.slice(s.indexOf(',') + 1) });
        };
        reader.readAsDataURL(b);
      });
      return;
    }
    return originalClick.apply(this, arguments);
  };
  // arquivos do sistema (PDFs e desenhos do projeto): o WebView não abre PDF, então vão para o compartilhar
  document.addEventListener('click', function (ev) {
    var a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
    if (!a || a.download) return;
    var url;
    try { url = new URL(a.href, location.href); } catch (e) { return; }
    if (url.origin !== location.origin || !/^\\/api\\/files\\/[^/]+\\/download$/.test(url.pathname)) return;
    ev.preventDefault();
    fetch(url.href).then(function (r) {
      var cd = r.headers.get('content-disposition') || '';
      var m = /filename\\*=UTF-8''([^;]+)/i.exec(cd) || /filename="?([^";]+)"?/i.exec(cd);
      var name = m ? decodeURIComponent(m[1]) : ((a.textContent || '').trim() || 'arquivo');
      return r.blob().then(function (b) {
        var reader = new FileReader();
        reader.onload = function () {
          var s = String(reader.result);
          post({ type: 'download', name: name, mime: b.type, base64: s.slice(s.indexOf(',') + 1) });
        };
        reader.readAsDataURL(b);
      });
    });
  }, true);
  var originalRemove = Storage.prototype.removeItem;
  Storage.prototype.removeItem = function (key) {
    if (key === 'arcoplan.token') post({ type: 'logout' });
    return originalRemove.apply(this, arguments);
  };
})();
true;
`

const safeName = (name: string) => name.replace(/[^\w.\-() ]+/g, '_').slice(0, 80) || 'arquivo'

export function ShellScreen({ token, onLogout }: { token: string; onLogout: () => void }) {
  const web = useRef<WebView>(null)
  const canGoBack = useRef(false)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const script = useMemo(() => bridge(token), [token])

  // permissões usadas pelo site: localização (ponto, rota das entregas) e câmera (foto de material, anexos)
  useEffect(() => {
    if (Platform.OS !== 'android') return
    void PermissionsAndroid.requestMultiple([PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION, PermissionsAndroid.PERMISSIONS.CAMERA]).catch(() => undefined)
  }, [])

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canGoBack.current) {
        web.current?.goBack()
        return true
      }
      return false
    })
    return () => sub.remove()
  }, [])

  const saveAndShare = useCallback(async (name: string, mime: string, base64: string) => {
    try {
      const uri = `${FileSystem.cacheDirectory}${safeName(name)}`
      await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 })
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: mime || undefined, dialogTitle: name })
      else Alert.alert('Arquivo salvo', 'Não há aplicativo para abrir este arquivo.')
    } catch {
      Alert.alert('Não foi possível abrir o arquivo', 'Tente gerar de novo.')
    }
  }, [])

  const onMessage = (event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data) as { type: string; name?: string; mime?: string; base64?: string }
      if (data.type === 'logout') onLogout()
      else if (data.type === 'download' && data.base64) void saveAndShare(data.name ?? 'arquivo', data.mime ?? '', data.base64)
    } catch {
      /* mensagem que não é nossa */
    }
  }

  return (
    <View style={styles.root}>
      <WebView
        ref={web}
        source={{ uri: `${BASE_URL}${HOME_PATH}` }}
        applicationNameForUserAgent={APP_UA}
        injectedJavaScriptBeforeContentLoaded={script}
        onMessage={onMessage}
        javaScriptEnabled
        domStorageEnabled
        geolocationEnabled
        // câmera dentro da página (ler o QR das etiquetas no chão de fábrica): no iPhone o vídeo precisa
        // tocar embutido e a permissão vale para o próprio site (o sistema ainda pede a câmera uma vez)
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        mediaCapturePermissionGrantType="grantIfSameHostElsePrompt"
        pullToRefreshEnabled
        setSupportMultipleWindows={false}
        mixedContentMode="never"
        allowFileAccess={false}
        thirdPartyCookiesEnabled={false}
        originWhitelist={['https://*']}
        onLoadStart={() => {
          setLoading(true)
          setFailed(false)
        }}
        onLoadEnd={() => setLoading(false)}
        onError={() => setFailed(true)}
        onHttpError={(e) => {
          if (e.nativeEvent.statusCode >= 500) setFailed(true)
        }}
        onNavigationStateChange={(nav) => {
          canGoBack.current = nav.canGoBack
          try {
            const url = new URL(nav.url)
            // o site mandou para o login: a sessão acabou, volta para a entrada nativa
            if (url.host === HOST && /^\/login\/?$/.test(url.pathname)) onLogout()
          } catch {
            /* url inválida */
          }
        }}
        onShouldStartLoadWithRequest={(request) => {
          try {
            const url = new URL(request.url)
            if (url.protocol === 'about:' || url.protocol === 'blob:' || url.protocol === 'data:') return true
            if (url.host === HOST) return true
            // pagamento, WhatsApp, mapas, DANFE do provedor etc.: abre no navegador do aparelho
            void Linking.openURL(request.url)
            return false
          } catch {
            return false
          }
        }}
        style={styles.web}
      />
      {loading && !failed ? (
        <View style={styles.loading} pointerEvents="none">
          <ActivityIndicator color={colors.brand} />
        </View>
      ) : null}
      {failed ? (
        <View style={styles.failed}>
          <Text style={styles.failedTitle}>Sem conexão com o Core Cut</Text>
          <Text style={styles.failedText}>Confira a internet e tente de novo.</Text>
          <Pressable
            style={styles.retry}
            onPress={() => {
              setFailed(false)
              web.current?.reload()
            }}
          >
            <Text style={styles.retryText}>Tentar de novo</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  web: { flex: 1, backgroundColor: colors.bg },
  loading: { position: 'absolute', top: 12, alignSelf: 'center', backgroundColor: '#fff', borderRadius: 20, padding: 8, elevation: 3 },
  failed: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 8 },
  failedTitle: { fontSize: 20, fontWeight: '700', color: colors.text },
  failedText: { fontSize: 15, color: colors.textSecondary, textAlign: 'center' },
  retry: { marginTop: 12, backgroundColor: colors.brand, borderRadius: radius.button, paddingVertical: 14, paddingHorizontal: 28 },
  retryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
})
