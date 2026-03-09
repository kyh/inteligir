"use client";

import { LoginModal } from "@/components/auth/login-modal";
import { VersionHistoryModal } from "@/components/editor/version-history/version-history-modal";
import { ConfirmModal } from "@/components/modals/confirm-modal";
import { DiscardModal } from "@/components/modals/discard-modal";
import { createPushModal } from "@/components/modals/push-modal";
import { AlertDialog } from "@/components/ui/alert-dialog";

import { ExportDialog } from "../navbar/export-dialog";
import { ImportDialog } from "../navbar/import-dialog";
import { SettingsModal } from "../settings/settings-modal";

export const { ModalProvider, popAllModals, popModal, pushModal, useOnPushModal } = createPushModal(
  {
    modals: {
      Confirm: { Component: ConfirmModal, Wrapper: AlertDialog as any },
      Discard: { Component: DiscardModal, Wrapper: AlertDialog as any },
      Export: ExportDialog,
      Import: ImportDialog,
      Login: LoginModal,
      Settings: SettingsModal,
      VersionHistory: VersionHistoryModal,
    },
  },
);
