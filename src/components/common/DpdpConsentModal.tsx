import React from 'react';
import { PrivacyChoicesModal } from '../privacy/PrivacyChoicesModal';
import {
  EMPTY_CONSENT_CHOICES,
  type ConsentChoices,
} from './DpdpConsentBanner';
import type { OptionalConsentChoices } from '../../lib/privacyConsent';

interface DpdpConsentModalProps {
  isOpen?: boolean;
  onClose?: () => void;
  onSave?: (choices: ConsentChoices) => void;
  onOpenPrivacyPolicy?: () => void;
  source?: string;
}

/**
 * Delegates directly to the redesigned Privacy Choices & Consent Center modal
 * while preserving the existing component export name and prop contract.
 */
export const DpdpConsentModal: React.FC<DpdpConsentModalProps> = ({
  isOpen,
  onClose,
  onSave,
  onOpenPrivacyPolicy,
  source,
}) => {
  const handleSave = (savedOptional: OptionalConsentChoices) => {
    if (onSave) {
      onSave({
        ...EMPTY_CONSENT_CHOICES,
        ...savedOptional,
      });
    }
  };

  return (
    <PrivacyChoicesModal
      isOpen={isOpen}
      onClose={onClose}
      onSave={handleSave}
      onOpenPrivacyPolicy={onOpenPrivacyPolicy}
      source={source}
    />
  );
};
