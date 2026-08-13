import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";

const TENANT_ID = "observe-insurance";

type Config = {
  agentName: string;
  firstMessage: string;
  systemPrompt: string;
  settings: Record<string, unknown>;
  tools: unknown[];
};

export default function Admin() {
  const [token, setToken] = useState(() => sessionStorage.getItem("admin_token") || "");
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin");
  const [config, setConfig] = useState<Config>({ agentName: "Sarah", firstMessage: "", systemPrompt: "", settings: {}, tools: [] });
  const [message, setMessage] = useState("");
  const login = trpc.admin.login.useMutation();
  const save = trpc.admin.saveAgentConfig.useMutation();
  const stored = trpc.admin.getAgentConfig.useQuery({ token, tenantId: TENANT_ID }, { enabled: Boolean(token) });

  useEffect(() => {
    if (stored.data) {
      setConfig({
        agentName: stored.data.agentName,
        firstMessage: stored.data.firstMessage,
        systemPrompt: stored.data.systemPrompt,
        settings: stored.data.settings as Record<string, unknown>,
        tools: stored.data.tools,
      });
    }
  }, [stored.data]);

  if (!token) {
    return (
      <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
        <Card className="w-full max-w-md bg-slate-900 border-slate-700">
          <CardHeader><CardTitle>Tenant Admin Console</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <Input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Username" />
            <Input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" type="password" />
            <Button className="w-full" onClick={async () => {
              try {
                const result = await login.mutateAsync({ username, password });
                sessionStorage.setItem("admin_token", result.token);
                setToken(result.token);
                setMessage("Signed in");
              } catch {
                setMessage("Invalid admin credentials");
              }
            }}>Sign in</Button>
            {message && <p className="text-sm text-slate-300">{message}</p>}
            <p className="text-xs text-slate-400">Demo credentials: admin / admin. Set ADMIN_USERNAME, ADMIN_PASSWORD, and ADMIN_SESSION_SECRET in production.</p>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white p-6 md:p-10">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div><p className="text-sm text-cyan-300">Observe Agent Platform</p><h1 className="text-3xl font-semibold">Tenant behavior control plane</h1></div>
          <Button variant="outline" onClick={() => { sessionStorage.removeItem("admin_token"); setToken(""); }}>Sign out</Button>
        </div>
        <Card className="bg-slate-900 border-slate-700"><CardHeader><CardTitle>Conversation configuration</CardTitle></CardHeader><CardContent className="grid md:gri        <Cap-5">
          <label className="space-y-2 text-sm">Agent name<Input value={config.agentName} onChange={(e) => setConfig({ ...config, agentName: e.target.value })} /></label>
          <label className="space-y-2 text-sm">First message<Input value={config.firstMessage} onChange={(e) => setConfig({ ...config, firstMessage: e.target.value })} /></label>
          <label className="space-y-2 text-sm md:col-span-2">System prompt<Textarea className="min-h-64" value={config.systemPrompt} onChange={(e) => setConfig({ ...config, systemPrompt: e.target.value })} /></label>
          <label className="space-y-2 text-sm">Runtime settings JSON<Textarea className="min-h-40 font-mono" value={JSON.stringify(config.settings, null, 2)} onChange={(e) => { try { setConfig({ ...config, settings: JSON.parse(e.target.value) }); } catch { setMessage("Settings JSON is not valid yet"); } }} /></label>
          <label className="space-y-2 text-sm">Enabled tools JSON<Textarea className="min-h-40 font-mono" value={JSON.stringify(config.tools, null, 2)} onChange={(e) => { try { setConfig({ ...config, tools: JSON.parse(e.target.value) }); } catch { setMessage("Tools JSON is not valid yet"); } }} /></label>
          <div className="md:col-span-2 flex items-center gap-4"><Button onClick={async () => { const result = await save.mutateAsync({ token, tenantId: TENANT_ID, ...config }); setMessage(result.persisted ? `Published version ${result.version}` : "Saved in demo mode; configure DATABASE_URL for SQL persistence"); }}>Publish configuration</Button>{message && <span className="text-sm text-slate-300">{message}</span>}</div>
        </CardContent></Card>
      </div>
    </main>
  );
}
