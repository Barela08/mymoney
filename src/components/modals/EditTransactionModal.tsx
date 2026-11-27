import React, { useState, useEffect, useRef } from 'react';
import { X, Edit3, Camera, Image as ImageIcon, Loader2 } from 'lucide-react';
import { useExpense } from '../../context/ExpenseContext';
import { useToast } from '../../context/ToastContext';
import { Transaction, TransactionType } from '../../types';
import { formatDisplayDate } from '../../lib/dateUtils';
import { UnsavedChangesModal } from '../common/states';
import { processImageAttachment, isSafeAttachmentUrl } from '../../lib/attachmentUtils';

interface EditTransactionModalProps {
  transaction: Transaction | null;
  isOpen: boolean;
  onClose: () => void;
}

export const EditTransactionModal: React.FC<EditTransactionModalProps> = ({
  transaction,
  isOpen,
  onClose,
}) => {
  const { editTransaction } = useExpense();
  const toast = useToast();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [amount, setAmount] = useState<string>('');
  const [title, setTitle] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [personName, setPersonName] = useState<string>('');
  const [date, setDate] = useState<string>('');
  const [time, setTime] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [type, setType] = useState<TransactionType>('expense');
  const [paymentMethod, setPaymentMethod] = useState<string>('upi');
  const [utr, setUtr] = useState<string>('');
  const [categoryLabel, setCategoryLabel] = useState<string>('');
  const [attachmentUrl, setAttachmentUrl] = useState<string>('');
  const [attachmentName, setAttachmentName] = useState<string>('');
  const [attachmentMime, setAttachmentMime] = useState<string>('');
  const [attachmentSize, setAttachmentSize] = useState<number>(0);
  const [isProcessingImage, setIsProcessingImage] = useState<boolean>(false);

  const [showUnsavedConfirm, setShowUnsavedConfirm] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (transaction && isOpen) {
      setShowUnsavedConfirm(false);
      setAmount(String(transaction.amount));
      setTitle(transaction.title || '');
      setDescription(transaction.description || '');
      setPersonName(transaction.person_name || '');
      setDate(transaction.transaction_date || '');
      setTime(transaction.transaction_time || '');
      setNotes(transaction.notes || '');
      setType(transaction.transaction_type);
      setPaymentMethod(transaction.metadata?.payment_method || 'upi');
      setUtr(transaction.metadata?.utr || '');
      setCategoryLabel(transaction.metadata?.custom_category_label || transaction.metadata?.category_label || '');
      const existingUrl = transaction.metadata?.attachment_url;
      setAttachmentUrl(isSafeAttachmentUrl(existingUrl) ? String(existingUrl) : '');
      setAttachmentName(transaction.metadata?.attachment_name || '');
      setAttachmentMime(transaction.metadata?.attachment_mime || '');
      setAttachmentSize(Number(transaction.metadata?.attachment_size) || 0);
    }
  }, [transaction, isOpen]);

  const isDirty = Boolean(
    transaction && (
      String(transaction.amount) !== amount ||
      (transaction.title || '') !== title ||
      (transaction.description || '') !== description ||
      (transaction.person_name || '') !== personName ||
      (transaction.transaction_date || '') !== date ||
      (transaction.transaction_time || '') !== time ||
      (transaction.notes || '') !== notes ||
      transaction.transaction_type !== type ||
      (transaction.metadata?.payment_method || 'upi') !== paymentMethod ||
      (transaction.metadata?.utr || '') !== utr ||
      (transaction.metadata?.custom_category_label || transaction.metadata?.category_label || '') !== categoryLabel ||
      (isSafeAttachmentUrl(transaction.metadata?.attachment_url) ? String(transaction.metadata?.attachment_url) : '') !== attachmentUrl
    )
  );

  const handleAttemptClose = () => {
    if (isDirty) {
      setShowUnsavedConfirm(true);
    } else {
      onClose();
    }
  };

  const handleDiscardChanges = () => {
    setShowUnsavedConfirm(false);
    onClose();
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !showUnsavedConfirm) {
        handleAttemptClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isDirty, showUnsavedConfirm]);

  if (!isOpen || !transaction) return null;

  const handleFileSelected = async (file?: File | null) => {
    if (!file) return;
    setIsProcessingImage(true);
    try {
      const res = await processImageAttachment(file);
      if (!res.valid || !res.dataUrl) {
        toast.error('Invalid Attachment', res.error || 'Please pick a valid JPEG, PNG, or WEBP image.');
        return;
      }
      setAttachmentUrl(res.dataUrl);
      setAttachmentName(res.fileName || 'receipt.jpg');
      setAttachmentMime(res.mimeType || 'image/jpeg');
      setAttachmentSize(res.sizeBytes || 0);
    } finally {
      setIsProcessingImage(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      toast.error('Invalid Amount', 'Please enter a valid amount greater than 0');
      return;
    }

    if (!title.trim()) {
      toast.error('Title Required', 'Please provide a title or description');
      return;
    }

    try {
      setIsSubmitting(true);
      await editTransaction(transaction.id, {
        amount: parsedAmount,
        title: title.trim(),
        description: description.trim() || undefined,
        person_name: personName.trim() || undefined,
        transaction_date: date,
        transaction_time: time,
        notes: notes.trim() || undefined,
        transaction_type: type,
        metadata: {
          payment_method: paymentMethod,
          utr: (paymentMethod === 'upi' || paymentMethod === 'bank_transfer') && utr.trim() ? utr.trim() : undefined,
          category_label: categoryLabel.trim() || transaction.metadata?.category_label,
          custom_category_label:
            transaction.metadata?.custom_category_label && categoryLabel.trim()
              ? categoryLabel.trim()
              : transaction.metadata?.custom_category_label,
          attachment_url: attachmentUrl && isSafeAttachmentUrl(attachmentUrl) ? attachmentUrl : undefined,
          attachment_name: attachmentUrl ? attachmentName || 'receipt.jpg' : undefined,
          attachment_mime: attachmentUrl ? attachmentMime || 'image/jpeg' : undefined,
          attachment_size: attachmentUrl ? attachmentSize || undefined : undefined,
        },
      });

      toast.success('Record Updated', `Transaction "${title}" was successfully updated.`);
      onClose();
    } catch (err: any) {
      toast.error('Update Failed', err.message || 'Could not update transaction.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/60 backdrop-blur-sm animate-fade-in overflow-y-auto">
      <div className="relative w-full max-w-lg my-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0 bg-slate-50/50 dark:bg-slate-800/30">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-100 dark:bg-blue-950/80 rounded-xl text-blue-600 dark:text-blue-400">
              <Edit3 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100">
                Edit Transaction
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Category: <span className="capitalize font-semibold text-slate-700 dark:text-slate-300">{transaction.category === 'home' || transaction.category === 'received' ? 'Received Money' : transaction.category}</span>
                {' · '}
                Created {formatDisplayDate(transaction.created_at.slice(0, 10))}
              </p>
            </div>
          </div>
          <button
            onClick={handleAttemptClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4">
          {/* Amount */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Amount (₹ INR) <span className="text-rose-500">*</span>
            </label>
            <div className="relative rounded-xl shadow-sm">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 font-bold text-lg">
                ₹
              </div>
              <input
                type="number"
                step="any"
                min="0.01"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-bold text-lg tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Title / Expense Item <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Purpose / Description & Custom Label */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Purpose / Description
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Category Label
              </label>
              <input
                type="text"
                maxLength={40}
                value={categoryLabel}
                onChange={(e) => setCategoryLabel(e.target.value)}
                placeholder="e.g. Grocery Expenses"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Person Name (if applicable) */}
          {(transaction.category === 'people' || transaction.person_name) && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Person&apos;s Name
              </label>
              <input
                type="text"
                value={personName}
                onChange={(e) => setPersonName(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          {/* Payment Method & UTR */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Payment Method
              </label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="upi">UPI</option>
                <option value="cash">Cash</option>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="card">Card</option>
                <option value="wallet">Wallet</option>
                <option value="other">Other</option>
              </select>
            </div>
            {(paymentMethod === 'upi' || paymentMethod === 'bank_transfer') && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  UTR / Reference ID
                </label>
                <input
                  type="text"
                  maxLength={64}
                  value={utr}
                  onChange={(e) => setUtr(e.target.value)}
                  placeholder="Optional reference"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            )}
          </div>

          {/* Date & Time fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700/60">
            <div>
              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                Transaction Date
              </label>
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                Transaction Time (IST)
              </label>
              <input
                type="time"
                step="1"
                required
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Notes / Remarks
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          {/* Receipt / Photo Attachment */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              Receipt / Screenshot Attachment
            </label>
            <input
              ref={cameraRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                void handleFileSelected(f);
              }}
            />
            <input
              ref={uploadRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                void handleFileSelected(f);
              }}
            />

            {attachmentUrl && isSafeAttachmentUrl(attachmentUrl) ? (
              <div className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                <img
                  src={attachmentUrl}
                  alt="Receipt attachment"
                  className="w-12 h-12 rounded-lg object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                    {attachmentName || 'Receipt Image'}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <button
                      type="button"
                      onClick={() => uploadRef.current?.click()}
                      className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                    >
                      Replace
                    </button>
                    <span className="text-slate-300 dark:text-slate-600">·</span>
                    <button
                      type="button"
                      onClick={() => {
                        setAttachmentUrl('');
                        setAttachmentName('');
                        setAttachmentMime('');
                        setAttachmentSize(0);
                      }}
                      className="text-[11px] font-semibold text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={isProcessingImage}
                  onClick={() => cameraRef.current?.click()}
                  className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  {isProcessingImage ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5 text-emerald-600" />}
                  <span>Take Photo</span>
                </button>
                <button
                  type="button"
                  disabled={isProcessingImage}
                  onClick={() => uploadRef.current?.click()}
                  className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  {isProcessingImage ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImageIcon className="w-3.5 h-3.5 text-blue-600" />}
                  <span>Upload Image</span>
                </button>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800 shrink-0">
            <button
              type="button"
              onClick={handleAttemptClose}
              disabled={isSubmitting}
              className="px-4 py-2.5 text-sm font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl transition-all cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-2 px-6 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-60 rounded-xl shadow-lg shadow-blue-600/25 transition-all cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Updating...</span>
                </>
              ) : (
                <>
                  <Edit3 className="w-4 h-4" />
                  <span>Save Changes</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      <UnsavedChangesModal
        isOpen={showUnsavedConfirm}
        documentName={title || 'Transaction Record'}
        onStay={() => setShowUnsavedConfirm(false)}
        onDiscard={handleDiscardChanges}
      />
    </div>
  );
};
