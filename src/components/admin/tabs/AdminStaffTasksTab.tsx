import React, { useState, useEffect, useCallback } from 'react';
import {
  ClipboardList,
  Plus,
  RefreshCw,
  CheckCircle2,
  Clock,
  AlertTriangle,
  UserCheck,
  Filter,
} from 'lucide-react';
import type { StaffTaskItem } from '../../../types';
import { adminClient } from '../../../lib/adminApi';
import { useToast } from '../../../context/ToastContext';

interface StaffAccountOption {
  id: string;
  email: string;
  name: string;
  role: string;
}

export const AdminStaffTasksTab: React.FC = () => {
  const toast = useToast();
  const [tasks, setTasks] = useState<StaffTaskItem[]>([]);
  const [staffOptions, setStaffOptions] = useState<StaffAccountOption[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('support');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium');
  const [assignedTo, setAssignedTo] = useState<string>('');
  const [dueAt, setDueAt] = useState<string>('');

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [tasksRes, adminsRes] = await Promise.allSettled([
        adminClient.getStaffTasks({ status: statusFilter }),
        adminClient.getAdmins(),
      ]);

      if (tasksRes.status === 'fulfilled' && tasksRes.value?.success) {
        setTasks(Array.isArray(tasksRes.value.tasks) ? tasksRes.value.tasks : []);
      }
      if (adminsRes.status === 'fulfilled' && adminsRes.value?.success && Array.isArray(adminsRes.value.admins)) {
        setStaffOptions(
          adminsRes.value.admins.map((a: any) => ({
            id: a.id,
            email: a.email,
            name: a.display_name || a.full_name || a.email,
            role: a.role_slug || a.role || 'staff',
          }))
        );
      }
    } catch (err: any) {
      toast.error('Load Failed', err?.message || 'Unable to load staff tasks.');
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter, toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error('Title Required', 'Please provide a clear task title.');
      return;
    }
    setIsCreating(true);
    try {
      const res = await adminClient.createStaffTask({
        title: title.trim(),
        description: description.trim(),
        category,
        priority,
        assigned_to: assignedTo || null,
        due_at: dueAt || null,
      });
      if (res?.success) {
        toast.success('Task Assigned', 'Staff task created and staff notification dispatched.');
        setTitle('');
        setDescription('');
        setDueAt('');
        await loadData();
      }
    } catch (err: any) {
      toast.error('Create Failed', err?.message || 'Could not create task.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleUpdateStatus = async (taskId: string, nextStatus: string) => {
    try {
      const res = await adminClient.updateStaffTask(taskId, { status: nextStatus });
      if (res?.success && res?.task) {
        setTasks((prev) => prev.map((t) => (t.id === taskId ? res.task : t)));
        toast.success('Task Updated', `Task marked as ${nextStatus.replace('_', ' ')}.`);
      }
    } catch (err: any) {
      toast.error('Update Failed', err?.message || 'Could not update task.');
    }
  };

  const handleReassign = async (taskId: string, nextAssignee: string) => {
    try {
      const res = await adminClient.updateStaffTask(taskId, {
        assigned_to: nextAssignee || null,
      });
      if (res?.success && res?.task) {
        setTasks((prev) => prev.map((t) => (t.id === taskId ? res.task : t)));
        toast.success('Assignee Updated', 'Task assignment updated.');
      }
    } catch (err: any) {
      toast.error('Update Failed', err?.message || 'Could not reassign task.');
    }
  };

  return (
    <div className="space-y-6">
      {/* Create New Task Form */}
      <form
        onSubmit={handleCreateTask}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-sm space-y-4"
      >
        <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="w-9 h-9 rounded-xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center">
            <ClipboardList className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-black text-slate-900 dark:text-white">
              Assign New Staff Operations Task
            </h3>
            <p className="text-xs text-slate-500">
              Assigned tasks appear immediately inside Staff App (`/mystaff`) &amp; trigger Staff-only notifications.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="sm:col-span-2">
            <label className="block text-xs font-bold mb-1">Task Title *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Review pending KYC/Udhar complaint #482"
              required
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
            />
          </div>
          <div>
            <label className="block text-xs font-bold mb-1">Assign To Staff</label>
            <select
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
            >
              <option value="">All Verified Staff Queue</option>
              {staffOptions.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.name} ({st.role})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold mb-1">Priority</label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as any)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-bold mb-1">Instructions / Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional resolution notes or SLA expectations..."
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
            />
          </div>
          <div>
            <label className="block text-xs font-bold mb-1">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
            >
              <option value="support">Support Ticket</option>
              <option value="moderation">Moderation / Trust</option>
              <option value="audit">Financial Access Audit</option>
              <option value="operations">Operations</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold mb-1">Due Date (Optional)</label>
            <input
              type="date"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={isCreating}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold cursor-pointer disabled:opacity-60"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{isCreating ? 'Assigning...' : 'Assign Staff Task'}</span>
          </button>
        </div>
      </form>

      {/* Task Queue */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400" />
            <h3 className="text-sm font-black text-slate-900 dark:text-white">
              Staff Tasks ({tasks.length})
            </h3>
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
              onClick={loadData}
              className="p-1.5 rounded-xl border border-slate-200 dark:border-slate-700 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {isLoading ? (
          <p className="text-xs text-slate-400 py-8 text-center">Loading staff tasks...</p>
        ) : tasks.length === 0 ? (
          <p className="text-xs text-slate-400 py-8 text-center">
            No tasks match the current filter.
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
                    <p className="text-xs text-slate-500 dark:text-slate-400">{task.description}</p>
                  )}
                  <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
                    <UserCheck className="w-3 h-3" />
                    <span>
                      Assignee: {task.assigned_to_name || task.assigned_to_email || 'Shared Staff Queue'}
                    </span>
                    {task.due_at && (
                      <span>· Due {new Date(task.due_at).toLocaleDateString('en-IN')}</span>
                    )}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <select
                    value={task.assigned_to || ''}
                    onChange={(e) => handleReassign(task.id, e.target.value)}
                    className="px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                  >
                    <option value="">Shared Queue</option>
                    {staffOptions.map((st) => (
                      <option key={st.id} value={st.id}>
                        {st.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={task.status}
                    onChange={(e) => handleUpdateStatus(task.id, e.target.value)}
                    className="px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold"
                  >
                    <option value="open">Open</option>
                    <option value="in_progress">In Progress</option>
                    <option value="completed">Completed</option>
                    <option value="blocked">Blocked</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminStaffTasksTab;
