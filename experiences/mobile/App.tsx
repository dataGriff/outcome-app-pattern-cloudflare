import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, Pressable, FlatList } from 'react-native';
import createClient from 'openapi-fetch';
import type { paths, components } from './src/api/schema';

type ColourEvent = components['schemas']['ColourEvent'];
type FeedItem = ColourEvent & { key: string };

const API = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8787';
const DOTS: Record<ColourEvent['colour'], string> = {
  red: '#e5484d',
  amber: '#ffb224',
  green: '#30a46c',
};

// Typed client generated from the committed OpenAPI contract (task gen:client) —
// the experience cannot call an endpoint or read a field the contract doesn't define.
const client = createClient<paths>({ baseUrl: API });

export default function App() {
  const [latest, setLatest] = useState<ColourEvent | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [conn, setConn] = useState('connecting…');

  useEffect(() => {
    client
      .GET('/colours/latest')
      .then(({ data }) => data && setLatest(data))
      .catch(() => {});

    // Web export runs in a browser, where EventSource is available. SSE is not
    // part of the typed surface — it's a raw text/event-stream. Mobile talks to
    // the domain API directly (the CORS-enabled channel; web uses a proxy).
    if (typeof EventSource === 'undefined') return;
    const es = new EventSource(`${API}/events/stream`);
    es.onopen = () => setConn('live');
    es.onerror = () => setConn('reconnecting…');
    es.onmessage = (m: MessageEvent) => {
      const ev: ColourEvent = JSON.parse(m.data);
      setLatest(ev);
      setFeed((f) => [{ ...ev, key: `${ev.timestamp}-${f.length}` }, ...f].slice(0, 10));
    };
    return () => es.close();
  }, []);

  const generate = async () => {
    try {
      const { data } = await client.POST('/colours');
      if (data) setLatest(data);
    } catch (e) {
      // ignore in demo
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.h1}>Mobile experience</Text>
      <Text style={styles.p}>
        Expo / React Native consuming the same behaviour API — POST /colours to
        generate, SSE for the live feed.
      </Text>

      <Pressable style={styles.btn} onPress={generate}>
        <Text style={styles.btnText}>Generate colour</Text>
      </Pressable>

      <View style={styles.latestRow}>
        <View style={[styles.dot, { backgroundColor: latest ? DOTS[latest.colour] : '#ccc' }]} />
        <Text style={styles.latestText}>
          {latest ? `${latest.colour}  ${latest.timestamp}` : '—'}
        </Text>
      </View>

      <Text style={styles.h2}>Live events ({conn})</Text>
      <FlatList
        style={styles.feed}
        data={feed}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) => (
          <View style={styles.feedItem}>
            <View style={[styles.dot, { backgroundColor: DOTS[item.colour] || '#888' }]} />
            <Text style={styles.feedText}>
              {item.colour}  {item.timestamp}
            </Text>
          </View>
        )}
      />

      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', padding: 24, paddingTop: 64, maxWidth: 640, width: '100%', alignSelf: 'center' },
  h1: { fontSize: 28, fontWeight: '700', marginBottom: 8 },
  h2: { fontSize: 18, fontWeight: '600', marginTop: 24, marginBottom: 8 },
  p: { color: '#444', marginBottom: 20 },
  btn: { backgroundColor: '#111', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 8, alignSelf: 'flex-start' },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  latestRow: { flexDirection: 'row', alignItems: 'center', marginTop: 16 },
  latestText: { fontSize: 16 },
  dot: { width: 14, height: 14, borderRadius: 7, marginRight: 10 },
  feed: { marginTop: 4 },
  feedItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 10, backgroundColor: '#f4f4f4', borderRadius: 6, marginBottom: 6 },
  feedText: { fontVariant: ['tabular-nums'] },
});
