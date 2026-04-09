import { StatusBar } from "expo-status-bar";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useMemo, useState } from "react";
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

const API_URL = process.env.EXPO_PUBLIC_API_URL || "http://localhost:4000";

type User = { id: string; name: string; email: string; role: "ADMIN" | "ATTENDEE" | "SPEAKER" };

type Session = { id: string; title: string; description?: string; startsAt: string; endsAt: string };

type Announcement = { id: string; title: string; body: string; createdAt: string };

type Message = { id: string; body: string; createdAt: string; user: { name: string; role: string } };

type Survey = { id: string; title: string; questions: { id: string; prompt: string }[] };
type ConversationMember = { user: { id: string; name: string; role: string } };
type Conversation = {
  id: string;
  name?: string | null;
  type: "EVENT" | "DIRECT" | "GROUP";
  members: ConversationMember[];
};

async function apiFetch<T>(path: string, options: RequestInit = {}, token?: string) {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ? JSON.stringify(data.error) : "Request failed");
  }

  return (await res.json()) as T;
}

const tabs = ["Agenda", "Announcements", "Surveys", "Messages", "Check-In"] as const;

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [active, setActive] = useState<(typeof tabs)[number]>("Agenda");

  const [sessions, setSessions] = useState<Session[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [attendees, setAttendees] = useState<User[]>([]);
  const [groupName, setGroupName] = useState("");
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      const storedToken = await AsyncStorage.getItem("token");
      const storedUser = await AsyncStorage.getItem("user");
      if (storedToken && storedUser) {
        setToken(storedToken);
        setUser(JSON.parse(storedUser));
      }
    })();
  }, []);

  useEffect(() => {
    if (!token) return;
    const load = async () => {
      if (active === "Agenda") {
        setSessions(await apiFetch<Session[]>("/sessions", {}, token));
      }
      if (active === "Announcements") {
        setAnnouncements(await apiFetch<Announcement[]>("/announcements", {}, token));
      }
      if (active === "Surveys") {
        setSurveys(await apiFetch<Survey[]>("/surveys", {}, token));
      }
      if (active === "Messages") {
        const convoList = await apiFetch<Conversation[]>("/conversations", {}, token);
        setConversations(convoList);
        if (!activeConversationId && convoList.length > 0) {
          setActiveConversationId(convoList[0].id);
        }
        if (attendees.length === 0) {
          setAttendees(await apiFetch<User[]>("/attendees", {}, token));
        }
      }
    };
    load();
  }, [active, token]);

  useEffect(() => {
    if (!token || active !== "Messages" || !activeConversationId) return;
    apiFetch<Message[]>(`/conversations/${activeConversationId}/messages`, {}, token)
      .then(setMessages)
      .catch(() => null);
  }, [active, activeConversationId, token]);

  const isLoggedIn = !!token;
  const isAdmin = useMemo(() => user?.role === "ADMIN", [user]);

  const handleAuth = async (payload: any) => {
    const data = await apiFetch<{ token: string; user: User }>(
      `/auth/${mode === "login" ? "login" : "register"}`,
      { method: "POST", body: JSON.stringify(payload) }
    );
    setToken(data.token);
    setUser(data.user);
    await AsyncStorage.setItem("token", data.token);
    await AsyncStorage.setItem("user", JSON.stringify(data.user));
  };

  const handleLogout = async () => {
    setToken(null);
    setUser(null);
    await AsyncStorage.removeItem("token");
    await AsyncStorage.removeItem("user");
  };

  const startDirectChat = async (otherUserId: string) => {
    if (!token) return;
    const conversation = await apiFetch<Conversation>("/conversations/direct", {
      method: "POST",
      body: JSON.stringify({ userId: otherUserId }),
    }, token);
    setConversations([conversation, ...conversations.filter((c) => c.id !== conversation.id)]);
    setActiveConversationId(conversation.id);
  };

  const toggleMember = (userId: string) => {
    setSelectedMemberIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const createGroupChat = async () => {
    if (!token || !groupName || selectedMemberIds.length === 0) return;
    const conversation = await apiFetch<Conversation>("/conversations/group", {
      method: "POST",
      body: JSON.stringify({ name: groupName, memberIds: selectedMemberIds }),
    }, token);
    setConversations([conversation, ...conversations]);
    setActiveConversationId(conversation.id);
    setGroupName("");
    setSelectedMemberIds([]);
  };

  if (!isLoggedIn) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style="dark" />
        <View style={styles.card}>
          <Text style={styles.title}>Event Hub</Text>
          <View style={styles.row}>
            <TouchableOpacity onPress={() => setMode("login")} style={[styles.pill, mode === "login" && styles.pillActive]}>
              <Text style={[styles.pillText, mode === "login" && styles.pillTextActive]}>Login</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setMode("register")} style={[styles.pill, mode === "register" && styles.pillActive]}>
              <Text style={[styles.pillText, mode === "register" && styles.pillTextActive]}>Register</Text>
            </TouchableOpacity>
          </View>
          <AuthForm mode={mode} onSubmit={handleAuth} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Welcome, {user?.name}</Text>
          <Text style={styles.subtitle}>{user?.role}</Text>
        </View>
        <TouchableOpacity onPress={handleLogout} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Logout</Text>
        </TouchableOpacity>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabs}>
        {tabs.map((tab) => (
          <TouchableOpacity key={tab} onPress={() => setActive(tab)} style={[styles.pill, active === tab && styles.pillActive]}>
            <Text style={[styles.pillText, active === tab && styles.pillTextActive]}>{tab}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={styles.content}>
        {active === "Agenda" && sessions.map((s) => (
          <View key={s.id} style={styles.card}>
            <Text style={styles.cardTitle}>{s.title}</Text>
            <Text style={styles.subtitle}>{s.description}</Text>
            <Text style={styles.meta}>{new Date(s.startsAt).toLocaleString()}</Text>
          </View>
        ))}

        {active === "Announcements" && announcements.map((a) => (
          <View key={a.id} style={styles.card}>
            <Text style={styles.cardTitle}>{a.title}</Text>
            <Text style={styles.subtitle}>{a.body}</Text>
            <Text style={styles.meta}>{new Date(a.createdAt).toLocaleString()}</Text>
          </View>
        ))}

        {active === "Surveys" && surveys.map((s) => (
          <SurveyCard key={s.id} survey={s} token={token!} />
        ))}

        {active === "Messages" && (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Conversations</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {conversations.map((c) => (
                  <TouchableOpacity
                    key={c.id}
                    onPress={() => setActiveConversationId(c.id)}
                    style={[styles.pill, activeConversationId === c.id && styles.pillActive]}
                  >
                    <Text style={[styles.pillText, activeConversationId === c.id && styles.pillTextActive]}>
                      {formatConversationName(c, user)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Start a chat</Text>
              {attendees.filter((a) => a.id !== user?.id).map((a) => (
                <TouchableOpacity
                  key={a.id}
                  onPress={() => startDirectChat(a.id)}
                  style={styles.secondaryButton}
                >
                  <Text style={styles.secondaryButtonText}>Chat with {a.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Create group</Text>
              <TextInput
                value={groupName}
                onChangeText={setGroupName}
                placeholder="Group name"
                style={styles.input}
              />
              {attendees.filter((a) => a.id !== user?.id).map((a) => {
                const selected = selectedMemberIds.includes(a.id);
                return (
                  <TouchableOpacity
                    key={a.id}
                    onPress={() => toggleMember(a.id)}
                    style={[styles.pill, selected && styles.pillActive]}
                  >
                    <Text style={[styles.pillText, selected && styles.pillTextActive]}>
                      {selected ? "✓ " : ""}{a.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
              <TouchableOpacity onPress={createGroupChat} style={styles.primaryButton}>
                <Text style={styles.primaryButtonText}>Create group</Text>
              </TouchableOpacity>
            </View>
            <MessageComposer
              token={token!}
              conversationId={activeConversationId}
              onSent={(m) => setMessages([...messages, m])}
            />
            {messages.map((m) => (
              <View key={m.id} style={styles.card}>
                <Text style={styles.cardTitle}>{m.user.name}</Text>
                <Text style={styles.subtitle}>{m.body}</Text>
                <Text style={styles.meta}>{new Date(m.createdAt).toLocaleString()}</Text>
              </View>
            ))}
          </>
        )}

        {active === "Check-In" && (
          <CheckInSelf token={token!} isAdmin={isAdmin} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function AuthForm({ mode, onSubmit }: { mode: "login" | "register"; onSubmit: (payload: any) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  return (
    <View style={{ gap: 12 }}>
      {mode === "register" && (
        <TextInput value={name} onChangeText={setName} placeholder="Full name" style={styles.input} />
      )}
      <TextInput value={email} onChangeText={setEmail} placeholder="Email" autoCapitalize="none" style={styles.input} />
      <TextInput value={password} onChangeText={setPassword} placeholder="Password" secureTextEntry style={styles.input} />
      <TouchableOpacity
        onPress={() => onSubmit({ name, email, password, role: "ATTENDEE" })}
        style={styles.primaryButton}
      >
        <Text style={styles.primaryButtonText}>{mode === "login" ? "Login" : "Create account"}</Text>
      </TouchableOpacity>
    </View>
  );
}

function MessageComposer({
  token,
  conversationId,
  onSent,
}: { token: string; conversationId: string | null; onSent: (m: Message) => void }) {
  const [body, setBody] = useState("");

  const send = async () => {
    if (!conversationId) return;
    const message = await apiFetch<Message>(`/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify({ body }),
    }, token);
    onSent(message);
    setBody("");
  };

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Chat</Text>
      <TextInput value={body} onChangeText={setBody} placeholder="Write a message" style={styles.input} />
      <TouchableOpacity onPress={send} style={styles.primaryButton} disabled={!conversationId}>
        <Text style={styles.primaryButtonText}>Send</Text>
      </TouchableOpacity>
    </View>
  );
}

function SurveyCard({ survey, token }: { survey: Survey; token: string }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const submit = async () => {
    const payload = {
      answers: survey.questions.map((q) => ({ questionId: q.id, answer: answers[q.id] || "" })),
    };
    await apiFetch(`/surveys/${survey.id}/answers`, {
      method: "POST",
      body: JSON.stringify(payload),
    }, token);
  };

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{survey.title}</Text>
      {survey.questions.map((q) => (
        <TextInput
          key={q.id}
          placeholder={q.prompt}
          value={answers[q.id] || ""}
          onChangeText={(text) => setAnswers({ ...answers, [q.id]: text })}
          style={styles.input}
        />
      ))}
      <TouchableOpacity onPress={submit} style={styles.secondaryButton}>
        <Text style={styles.secondaryButtonText}>Submit</Text>
      </TouchableOpacity>
    </View>
  );
}

function CheckInSelf({ token, isAdmin }: { token: string; isAdmin: boolean }) {
  const [status, setStatus] = useState<string | null>(null);

  const handle = async () => {
    await apiFetch("/checkins", { method: "POST" }, token);
    setStatus("Checked in!");
  };

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Check in</Text>
      <Text style={styles.subtitle}>Tap to mark yourself checked in.</Text>
      <TouchableOpacity onPress={handle} style={styles.primaryButton}>
        <Text style={styles.primaryButtonText}>Check in</Text>
      </TouchableOpacity>
      {status && <Text style={styles.meta}>{status}</Text>}
      {isAdmin && <Text style={styles.meta}>Admin view of check-ins is available on web.</Text>}
    </View>
  );
}

function formatConversationName(conversation: Conversation, currentUser: User | null) {
  if (conversation.type === "EVENT") return conversation.name || "Event Chat";
  if (conversation.type === "GROUP") return conversation.name || "Group Chat";
  const other = conversation.members.find((m) => m.user.id !== currentUser?.id);
  return other ? other.user.name : "Direct Chat";
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8fbff",
    padding: 16,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#0b2b6b",
  },
  subtitle: {
    color: "#475569",
    marginTop: 4,
  },
  meta: {
    color: "#64748b",
    marginTop: 6,
  },
  tabs: {
    marginVertical: 8,
  },
  content: {
    gap: 12,
    paddingBottom: 40,
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#dbeafe",
    gap: 8,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#0f172a",
  },
  input: {
    borderWidth: 1,
    borderColor: "#dbeafe",
    borderRadius: 10,
    padding: 10,
    backgroundColor: "#ffffff",
  },
  row: {
    flexDirection: "row",
    gap: 8,
    marginVertical: 10,
  },
  pill: {
    borderWidth: 1,
    borderColor: "#dbeafe",
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 14,
    backgroundColor: "#ffffff",
  },
  pillActive: {
    backgroundColor: "#1d4ed8",
    borderColor: "#1d4ed8",
  },
  pillText: {
    color: "#0b2b6b",
  },
  pillTextActive: {
    color: "#ffffff",
  },
  primaryButton: {
    backgroundColor: "#1d4ed8",
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
  },
  primaryButtonText: {
    color: "#ffffff",
    fontWeight: "600",
  },
  secondaryButton: {
    backgroundColor: "#eff6ff",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: "#bfdbfe",
  },
  secondaryButtonText: {
    color: "#1e3a8a",
    fontWeight: "600",
  },
});
