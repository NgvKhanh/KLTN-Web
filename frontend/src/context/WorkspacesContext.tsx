import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { fetchMyWorkspaces } from '../lib/api/workspace';
import { getErrorMessage } from '../lib/errorMessage';
import { socket } from '../lib/socket';
import type { Workspace } from '../types/workspace';

const LS_KEY = 'taskflow.currentWorkspace';

function readStored(): string | null {
  try {
    return localStorage.getItem(LS_KEY);
  } catch {
    return null;
  }
}
function writeStored(id: string) {
  try {
    localStorage.setItem(LS_KEY, id);
  } catch {
    /* bo qua */
  }
}

interface WorkspacesContextValue {
  workspaces: Workspace[];
  isLoading: boolean;
  error: string | null;
  currentWorkspaceId: string | null;
  currentWorkspace: Workspace | undefined;
  setCurrentWorkspaceId: (id: string) => void;
  reload: () => Promise<void>;
  upsertWorkspace: (ws: Workspace) => void;
  removeWorkspace: (id: string) => void;
}

const WorkspacesContext = createContext<WorkspacesContextValue | undefined>(
  undefined
);

export function WorkspacesProvider({ children }: { children: ReactNode }) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(() => readStored());

  const reload = useCallback(async () => {
    try {
      const list = await fetchMyWorkspaces();
      setWorkspaces(list);
      setError(null);
      // Chot lai khong gian dang chon neu no khong con hop le
      setCurrentId((cur) => {
        if (cur && list.some((w) => w.id === cur)) return cur;
        const fallback = list.find((w) => w.isPersonal) ?? list[0];
        return fallback?.id ?? null;
      });
    } catch (err) {
      setError(getErrorMessage(err, 'Không tải được danh sách không gian.'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Realtime: thanh vien / khong gian doi -> tai lai
  useEffect(() => {
    const onChanged = () => void reload();
    socket.on('workspace:changed', onChanged);
    return () => {
      socket.off('workspace:changed', onChanged);
    };
  }, [reload]);

  const setCurrentWorkspaceId = useCallback((id: string) => {
    setCurrentId(id);
    writeStored(id);
  }, []);

  const upsertWorkspace = useCallback((ws: Workspace) => {
    setWorkspaces((cur) => {
      const idx = cur.findIndex((w) => w.id === ws.id);
      if (idx === -1) return [...cur, ws];
      const next = [...cur];
      next[idx] = { ...next[idx], ...ws };
      return next;
    });
  }, []);

  const removeWorkspace = useCallback((id: string) => {
    setWorkspaces((cur) => cur.filter((w) => w.id !== id));
    setCurrentId((cur) => (cur === id ? null : cur));
  }, []);

  const currentWorkspace = useMemo(
    () => workspaces.find((w) => w.id === currentId),
    [workspaces, currentId]
  );

  return (
    <WorkspacesContext.Provider
      value={{
        workspaces,
        isLoading,
        error,
        currentWorkspaceId: currentId,
        currentWorkspace,
        setCurrentWorkspaceId,
        reload,
        upsertWorkspace,
        removeWorkspace,
      }}
    >
      {children}
    </WorkspacesContext.Provider>
  );
}

export function useWorkspaces(): WorkspacesContextValue {
  const ctx = useContext(WorkspacesContext);
  if (!ctx) {
    throw new Error('useWorkspaces phải được dùng bên trong WorkspacesProvider');
  }
  return ctx;
}
