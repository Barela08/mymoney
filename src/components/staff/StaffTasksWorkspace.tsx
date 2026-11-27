import React, { useState, useEffect, useCallback } from 'react';
import {
  ClipboardCheck,
  RefreshCw,
  CheckCircle2,
  Clock,
  AlertTriangle,
  PlayCircle,
  RotateCcw,
} from 'lucide-react';
import type { StaffTaskItem } from '../../types';
import { staffClient } from '../../lib/staffApi';
import { useToast } from '../../context/ToastContext';

export const StaffTasksWorkspace: React.FC = () => {
  const toast = useToast();
  const [tasks, setTasks] = useState<StaffTaskItem[]>([]);
  const [counts, setCounts] = useState({
    total: 0,
    open: 0,
    in_progress: 0,
    completed: 0,
    blocked: 0,
  });
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const loadTasks = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await staffClient.getTasks(statusFilter);
      if (res?.success) {
        setTasks(Array.isArray(res.tasks) ? res.tasks : []);
        if (res.counts) setCounts(res.counts);
      }
    } catch (err: any) {
      toast.error('Load Failed', err?.message || 'Unable to fetch assigned staff tasks.');
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter, toast]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  const handleStatusChange = async (
    taskId: string,
    nextStatus: 'open' | 'in_progress' | 'completed' | 'blocked'
  ) => {
    setUpdatingId(taskId);
    try {
      const res = await staffClient.updateTaskStatus(taskId, nextStatus);
      if (res?.success) {
        toast.success('Task Updated', `Task moved to ${nextStatus.replace('_', ' ')}.`);
        await loadTasks();
      }
    } catch (err: any) {
      toast.error('Action Failed', err?.message || 'Could not update task status.');
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Open Queue', val: counts.open, color: 'text-amber-600 dark:text-amber-400' },
          { label: 'In Progress', val: counts.in_progress, color: 'text-indigo-600 dark:text-indigo-400' },
          { label: 'Completed', val: counts.completed, color: 'text-emerald-600 dark:text-emerald-400' },
          { label: 'Blocked', val: counts.blocked, color: 'text-rose-600 dark:text-rose-400' },
        ].map((item) => (
          <div
            key={item.label}
            className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs"
          >
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              {item.label}
            </p>
            <p className={`text-2xl font-black mt-1 ${item.color}`}>{item.val}</p>
          </div>
        ))}
      </div>

      {/* Filters + Task List */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="w-4 h-4 text-indigo-500" />
            <h3 className="text-sm font-black text-slate-900 dark:text-white">
              Assigned Operations Tasks ({tasks.length})
            </h3>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {(['all', 'open', 'in_progress', 'completed', 'blocked'] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1 rounded-xl text-xs font-bold capitalize cursor-pointer ${
                  statusFilter === st
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                }`}
              >
                {st.replace('_', ' ')}
              </button>
            ))}
            <button
              type="button"
              onClick={loadTasks}
              aria-label="Refresh tasks"
              className="p-1.5 rounded-xl border border-slate-200 dark:border-slate-700 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {isLoading ? (
          <p className="text-xs text-slate-400 py-8 text-center">Loading assigned tasks...</p>
        ) : tasks.length === 0 ? (
          <p className="text-xs text-slate-400 py-8 text-center">
            No assigned tasks in this view right now.
          </p>
        ) : (
          <div className="space-y-3">
            {tasks.map((task) => (
              <div
                key={task.id}
                className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 flex flex-col lg:flex-row lg:items-center justify-between gap-3"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase ${
                        task.priority === 'urgent'
                          ? 'bg-rose-100 text-rose-700'
                          : task.priority === 'high'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200'
                      }`}
                    >
                      {task.priority}
                    </span>
                    <span className="text-xs font-black text-slate-900 dark:text-white">
                      {task.title}
                    </span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 text-[10px] font-bold">
                      {task.status === 'completed' ? (
                        <CheckCircle2 className="w-3 h-3" />
                      ) : task.status === 'blocked' ? (
                        <AlertTriangle className="w-3 h-3" />
                      ) : (
                        <Clock className="w-3 h-3" />
                      )}
                      {task.status.replace('_', ' ')}
                    </span>
                  </div>
                  {task.description && (
                    <p className="text-xs text-slate-600 dark:text-slate-300">{task.description}</p>
                  )}
                  <p className="text-[11px] text-slate-400">
                    Category: {task.category}
                    {task.assigned_by_name ? ` · Assigned by ${task.assigned_by_name}` : ''}
                    {task.due_at ? ` · Due ${new Date(task.due_at).toLocaleDateString('en-IN')}` : ''}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {task.status !== 'in_progress' && task.status !== 'completed' && (
                    <button
                      type="button"
                      disabled={updatingId === task.id}
                      onClick={() => handleStatusChange(task.id, 'in_progress')}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                    >
                      <PlayCircle className="w-3.5 h-3.5" />
                      <span>Start</span>
                    </button>
                  )}
                  {task.status !== 'completed' && (
                    <button
                      type="button"
                      disabled={updatingId === task.id}
                      onClick={() => handleStatusChange(task.id, 'completed')}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Complete</span>
                    </button>
                  )}
                  {task.status !== 'blocked' && task.status !== 'completed' && (
                    <button
                      type="button"
                      disabled={updatingId === task.id}
                      onClick={() => handleStatusChange(task.id, 'blocked')}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-700 dark:text-amber-300 text-xs font-bold cursor-pointer disabled:opacity-50"
                    >
                      <AlertTriangle className="w-3.5 h-3.5" />
                      <span>Block</span>
                    </button>
                  )}
                  {(task.status === 'completed' || task.status === 'blocked') && (
                    <button
                      type="button"
                      disabled={updatingId === task.id}
                      onClick={() => handleStatusChange(task.id, 'open')}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 cursor-pointer disabled:opacity-50"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Reopen</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default StaffTasksWorkspace;
