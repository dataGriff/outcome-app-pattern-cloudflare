import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, TextInput, View, Pressable, FlatList } from 'react-native';
import createClient from 'openapi-fetch';
import type { paths, components } from './src/api/schema';
import { accessEnabled, getAccessToken, useAccessAuth } from './src/auth';
import { connectSse, type SseFrame } from './src/sse';

type Todo = components['schemas']['Todo'];

const API = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8787';

// Typed client generated from the committed OpenAPI contract (task gen:types) —
// the experience cannot call an endpoint or read a field the contract doesn't define.
const client = createClient<paths>({ baseUrl: API });

// Attach the Access identity token (when signed in) as a bearer on every call,
// so the domain can authenticate this native caller. Inert until sign-in
// (locally the API acts as the fixed dev identity instead).
client.use({
  onRequest({ request }) {
    const token = getAccessToken();
    if (token) request.headers.set('Authorization', `Bearer ${token}`);
    return request;
  },
});

/** Apply a live SSE frame to the list. Frames are the user's own mutations
 * echoed back (possibly from another device/channel), so this is an upsert /
 * remove keyed by id — idempotent against the optimistic local updates. */
function applyFrame(todos: Todo[], frame: SseFrame): Todo[] {
  const { type, data } = frame;
  if (type === 'todo.deleted') return todos.filter((t) => t.id !== data.todo_id);
  const existing = todos.find((t) => t.id === data.todo_id);
  const next: Todo = {
    id: data.todo_id,
    title: data.title,
    completed: data.completed,
    created_at: existing?.created_at ?? data.timestamp,
    completed_at: data.completed ? (existing?.completed_at ?? data.timestamp) : null,
  };
  if (!existing) return [next, ...todos];
  return todos.map((t) => (t.id === data.todo_id ? next : t));
}

export default function App() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [title, setTitle] = useState('');
  const [conn, setConn] = useState('connecting…');
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const auth = useAccessAuth();

  useEffect(() => {
    client
      .GET('/todos')
      .then(({ data }) => data && setTodos(data))
      .catch(() => {});

    return connectSse(`${API}/events/stream`, {
      getToken: getAccessToken,
      onFrame: (frame) => setTodos((t) => applyFrame(t, frame)),
      onStatus: setConn,
    });
  }, []);

  const rateLimitNotice = (response: Response): boolean => {
    if (response.status !== 429) return false;
    const retry = response.headers.get('Retry-After');
    setNotice(retry ? `Rate limited — try again in ${retry}s` : 'Rate limited — please wait a moment');
    return true;
  };

  // Guard against double-taps: a second tap while the POST is in flight would
  // create a duplicate todo. One tap, one todo.
  const add = async () => {
    const trimmed = title.trim();
    if (pending || !trimmed) return;
    setPending(true);
    try {
      const { data, response } = await client.POST('/todos', { body: { title: trimmed } });
      if (rateLimitNotice(response)) return;
      if (data) {
        setTodos((t) => (t.some((x) => x.id === data.id) ? t : [data, ...t]));
        setTitle('');
        setNotice(null);
      }
    } catch {
      setNotice('Network error — please try again');
    } finally {
      setPending(false);
    }
  };

  const toggle = async (todo: Todo) => {
    try {
      const { data, response } = await client.PATCH('/todos/{id}', {
        params: { path: { id: todo.id } },
        body: { completed: !todo.completed },
      });
      if (rateLimitNotice(response)) return;
      if (data) setTodos((t) => t.map((x) => (x.id === data.id ? data : x)));
    } catch {
      setNotice('Network error — please try again');
    }
  };

  const remove = async (todo: Todo) => {
    try {
      const { response } = await client.DELETE('/todos/{id}', {
        params: { path: { id: todo.id } },
      });
      if (rateLimitNotice(response)) return;
      if (response.status === 204) setTodos((t) => t.filter((x) => x.id !== todo.id));
    } catch {
      setNotice('Network error — please try again');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.h1}>Mobile experience</Text>
      <Text style={styles.p}>
        Expo / React Native consuming the same todo API — your todos, live-updated
        over the authenticated per-user SSE feed ({conn}).
      </Text>

      {accessEnabled && (
        <Pressable
          style={[styles.btn, styles.signIn]}
          onPress={auth.signIn}
          disabled={!auth.ready}
        >
          <Text style={styles.btnText}>Sign in with Access</Text>
        </Pressable>
      )}

      <View style={styles.addRow}>
        <TextInput
          style={styles.input}
          placeholder="What needs doing?"
          value={title}
          onChangeText={setTitle}
          onSubmitEditing={add}
          maxLength={256}
        />
        <Pressable style={styles.btn} onPress={add} disabled={pending}>
          <Text style={styles.btnText}>Add</Text>
        </Pressable>
      </View>

      {notice && <Text style={styles.notice}>{notice}</Text>}

      <FlatList
        style={styles.feed}
        data={todos}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.todoItem}>
            <Pressable style={styles.check} onPress={() => toggle(item)}>
              <Text style={styles.checkText}>{item.completed ? '☑' : '☐'}</Text>
            </Pressable>
            <Text style={[styles.todoText, item.completed && styles.doneText]} numberOfLines={2}>
              {item.title}
            </Text>
            <Pressable onPress={() => remove(item)}>
              <Text style={styles.delete}>✕</Text>
            </Pressable>
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
  p: { color: '#444', marginBottom: 20 },
  addRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  input: { flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  btn: { backgroundColor: '#111', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 8, alignSelf: 'flex-start', justifyContent: 'center' },
  signIn: { backgroundColor: '#1f6feb', marginBottom: 12 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  notice: { marginTop: 4, marginBottom: 8, color: '#b54708', backgroundColor: '#fff7e0', borderRadius: 6, paddingVertical: 8, paddingHorizontal: 12 },
  feed: { marginTop: 4 },
  todoItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12, backgroundColor: '#f4f4f4', borderRadius: 6, marginBottom: 6 },
  check: { marginRight: 10 },
  checkText: { fontSize: 20 },
  todoText: { flex: 1, fontSize: 16 },
  doneText: { textDecorationLine: 'line-through', color: '#888' },
  delete: { color: '#e5484d', fontSize: 16, paddingHorizontal: 6 },
});
