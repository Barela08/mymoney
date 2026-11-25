import { getStoredAuthToken } from './authApi';

const API_BASE = '';

async function request<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || `API request failed with status ${response.status}`);
  }

  return data;
}

// -------------------------------------------------------------
// 1. BUDGET TYPES & API
// -------------------------------------------------------------
export interface UserBudget {
  id: string;
  user_id: string;
  category: 'food' | 'room' | 'home' | 'other' | string;
  monthly_limit: number;
  alert_threshold: number;
  created_at: string;
  updated_at: string;
}

export const budgetApi = {
  async getBudgets(): Promise<{ success: boolean; budgets: UserBudget[] }> {
    try {
      return await request('/api/budgets', { method: 'GET' });
    } catch (err: any) {
      console.warn('Budget fetch error, checking localStorage:', err.message);
      const saved = localStorage.getItem('my_money_user_budgets');
      return { success: true, budgets: saved ? JSON.parse(saved) : [] };
    }
  },

  async saveBudget(payload: {
    category: string;
    monthly_limit: number;
    alert_threshold?: number;
  }): Promise<{ success: boolean; message: string; budget: UserBudget }> {
    try {
      const res = await request('/api/budgets', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      // Update cache
      budgetApi.getBudgets().then((r) => {
        if (r.budgets) localStorage.setItem('my_money_user_budgets', JSON.stringify(r.budgets));
      });
      return res;
    } catch (err: any) {
      // Local fallback
      const saved = localStorage.getItem('my_money_user_budgets');
      const list: UserBudget[] = saved ? JSON.parse(saved) : [];
      const existingIdx = list.findIndex((b) => b.category.toLowerCase() === payload.category.toLowerCase());
      const now = new Date().toISOString();
      const budget: UserBudget = {
        id: existingIdx >= 0 ? list[existingIdx].id : 'b_' + Date.now(),
        user_id: 'current_user',
        category: payload.category,
        monthly_limit: payload.monthly_limit,
        alert_threshold: payload.alert_threshold || 85,
        created_at: existingIdx >= 0 ? list[existingIdx].created_at : now,
        updated_at: now,
      };
      if (existingIdx >= 0) list[existingIdx] = budget;
      else list.push(budget);
      localStorage.setItem('my_money_user_budgets', JSON.stringify(list));
      return { success: true, message: 'Budget saved locally.', budget };
    }
  },

  async deleteBudget(id: string): Promise<{ success: boolean; message: string }> {
    try {
      const res = await request(`/api/budgets/${id}`, { method: 'DELETE' });
      const saved = localStorage.getItem('my_money_user_budgets');
      if (saved) {
        const list: UserBudget[] = JSON.parse(saved);
        localStorage.setItem('my_money_user_budgets', JSON.stringify(list.filter((b) => b.id !== id)));
      }
      return res;
    } catch {
      const saved = localStorage.getItem('my_money_user_budgets');
      if (saved) {
        const list: UserBudget[] = JSON.parse(saved);
        localStorage.setItem('my_money_user_budgets', JSON.stringify(list.filter((b) => b.id !== id)));
      }
      return { success: true, message: 'Budget removed.' };
    }
  },
};

// -------------------------------------------------------------
// 2. SAVINGS GOALS TYPES & API
// -------------------------------------------------------------
export interface SavingsGoal {
  id: string;
  user_id: string;
  title: string;
  target_amount: number;
  current_amount: number;
  target_date?: string | null;
  category: string;
  notes?: string | null;
  is_completed: boolean;
  created_at: string;
  updated_at: string;
}

export const savingsGoalsApi = {
  async getGoals(): Promise<{ success: boolean; goals: SavingsGoal[] }> {
    try {
      return await request('/api/savings-goals', { method: 'GET' });
    } catch (err: any) {
      console.warn('Savings goals fetch fallback:', err.message);
      const saved = localStorage.getItem('my_money_savings_goals');
      return { success: true, goals: saved ? JSON.parse(saved) : [] };
    }
  },

  async saveGoal(payload: {
    id?: string;
    title: string;
    target_amount: number;
    current_amount?: number;
    target_date?: string | null;
    category?: string;
    notes?: string | null;
    is_completed?: boolean;
  }): Promise<{ success: boolean; message: string; goal: SavingsGoal }> {
    try {
      const res = await request('/api/savings-goals', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      savingsGoalsApi.getGoals().then((r) => {
        if (r.goals) localStorage.setItem('my_money_savings_goals', JSON.stringify(r.goals));
      });
      return res;
    } catch (err: any) {
      const saved = localStorage.getItem('my_money_savings_goals');
      const list: SavingsGoal[] = saved ? JSON.parse(saved) : [];
      const now = new Date().toISOString();
      const goal: SavingsGoal = {
        id: payload.id || 'goal_' + Date.now(),
        user_id: 'current_user',
        title: payload.title,
        target_amount: payload.target_amount,
        current_amount: payload.current_amount || 0,
        target_date: payload.target_date || null,
        category: payload.category || 'general',
        notes: payload.notes || null,
        is_completed: (payload.current_amount || 0) >= payload.target_amount,
        created_at: now,
        updated_at: now,
      };
      const idx = list.findIndex((g) => g.id === goal.id);
      if (idx >= 0) list[idx] = goal;
      else list.unshift(goal);
      localStorage.setItem('my_money_savings_goals', JSON.stringify(list));
      return { success: true, message: 'Goal saved locally.', goal };
    }
  },

  async contributeToGoal(
    id: string,
    amount: number,
    action: 'add' | 'withdraw' = 'add'
  ): Promise<{ success: boolean; message: string; goal: SavingsGoal }> {
    try {
      return await request(`/api/savings-goals/${id}/contribute`, {
        method: 'POST',
        body: JSON.stringify({ amount, action }),
      });
    } catch (err: any) {
      const saved = localStorage.getItem('my_money_savings_goals');
      const list: SavingsGoal[] = saved ? JSON.parse(saved) : [];
      const goal = list.find((g) => g.id === id);
      if (!goal) throw new Error('Goal not found');
      goal.current_amount = action === 'withdraw'
        ? Math.max(0, goal.current_amount - amount)
        : goal.current_amount + amount;
      goal.is_completed = goal.current_amount >= goal.target_amount;
      goal.updated_at = new Date().toISOString();
      localStorage.setItem('my_money_savings_goals', JSON.stringify(list));
      return {
        success: true,
        message: action === 'withdraw' ? 'Withdrawn from goal' : 'Contribution added!',
        goal,
      };
    }
  },

  async deleteGoal(id: string): Promise<{ success: boolean; message: string }> {
    try {
      const res = await request(`/api/savings-goals/${id}`, { method: 'DELETE' });
      const saved = localStorage.getItem('my_money_savings_goals');
      if (saved) {
        const list: SavingsGoal[] = JSON.parse(saved);
        localStorage.setItem('my_money_savings_goals', JSON.stringify(list.filter((g) => g.id !== id)));
      }
      return res;
    } catch {
      const saved = localStorage.getItem('my_money_savings_goals');
      if (saved) {
        const list: SavingsGoal[] = JSON.parse(saved);
        localStorage.setItem('my_money_savings_goals', JSON.stringify(list.filter((g) => g.id !== id)));
      }
      return { success: true, message: 'Goal deleted.' };
    }
  },
};

// -------------------------------------------------------------
// 3. RECURRING BILLS TYPES & API
// -------------------------------------------------------------
export interface RecurringBill {
  id: string;
  user_id: string;
  title: string;
  category: 'rent' | 'electricity' | 'internet' | 'subscription' | 'other' | string;
  amount: number;
  frequency: 'monthly' | 'weekly' | 'quarterly' | 'yearly' | string;
  due_day: number;
  next_due_date?: string | null;
  reminder_enabled: boolean;
  is_active: boolean;
  last_paid_date?: string | null;
  created_at: string;
  updated_at: string;
}

export const recurringBillsApi = {
  async getBills(): Promise<{ success: boolean; bills: RecurringBill[] }> {
    try {
      return await request('/api/recurring-bills', { method: 'GET' });
    } catch (err: any) {
      console.warn('Recurring bills fetch fallback:', err.message);
      const saved = localStorage.getItem('my_money_recurring_bills');
      return { success: true, bills: saved ? JSON.parse(saved) : [] };
    }
  },

  async saveBill(payload: {
    id?: string;
    title: string;
    category?: string;
    amount: number;
    frequency?: string;
    due_day: number;
    reminder_enabled?: boolean;
    is_active?: boolean;
  }): Promise<{ success: boolean; message: string; bill: RecurringBill }> {
    try {
      const res = await request('/api/recurring-bills', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      recurringBillsApi.getBills().then((r) => {
        if (r.bills) localStorage.setItem('my_money_recurring_bills', JSON.stringify(r.bills));
      });
      return res;
    } catch (err: any) {
      const saved = localStorage.getItem('my_money_recurring_bills');
      const list: RecurringBill[] = saved ? JSON.parse(saved) : [];
      const now = new Date().toISOString();
      const bill: RecurringBill = {
        id: payload.id || 'bill_' + Date.now(),
        user_id: 'current_user',
        title: payload.title,
        category: payload.category || 'other',
        amount: payload.amount,
        frequency: payload.frequency || 'monthly',
        due_day: payload.due_day,
        reminder_enabled: payload.reminder_enabled !== undefined ? payload.reminder_enabled : true,
        is_active: payload.is_active !== undefined ? payload.is_active : true,
        created_at: now,
        updated_at: now,
      };
      const idx = list.findIndex((b) => b.id === bill.id);
      if (idx >= 0) list[idx] = bill;
      else list.push(bill);
      localStorage.setItem('my_money_recurring_bills', JSON.stringify(list));
      return { success: true, message: 'Bill saved locally.', bill };
    }
  },

  async markBillPaid(id: string, paidDate?: string): Promise<{ success: boolean; message: string; bill: RecurringBill }> {
    try {
      return await request(`/api/recurring-bills/${id}/pay`, {
        method: 'POST',
        body: JSON.stringify({ paid_date: paidDate }),
      });
    } catch (err: any) {
      const saved = localStorage.getItem('my_money_recurring_bills');
      const list: RecurringBill[] = saved ? JSON.parse(saved) : [];
      const bill = list.find((b) => b.id === id);
      if (!bill) throw new Error('Bill not found');
      bill.last_paid_date = paidDate || new Date().toISOString().split('T')[0];
      bill.updated_at = new Date().toISOString();
      localStorage.setItem('my_money_recurring_bills', JSON.stringify(list));
      return { success: true, message: 'Bill marked as paid.', bill };
    }
  },

  async deleteBill(id: string): Promise<{ success: boolean; message: string }> {
    try {
      const res = await request(`/api/recurring-bills/${id}`, { method: 'DELETE' });
      const saved = localStorage.getItem('my_money_recurring_bills');
      if (saved) {
        const list: RecurringBill[] = JSON.parse(saved);
        localStorage.setItem('my_money_recurring_bills', JSON.stringify(list.filter((b) => b.id !== id)));
      }
      return res;
    } catch {
      const saved = localStorage.getItem('my_money_recurring_bills');
      if (saved) {
        const list: RecurringBill[] = JSON.parse(saved);
        localStorage.setItem('my_money_recurring_bills', JSON.stringify(list.filter((b) => b.id !== id)));
      }
      return { success: true, message: 'Bill deleted.' };
    }
  },
};

