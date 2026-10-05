import { App, Notice, PluginSettingTab, Setting, type Plugin } from "obsidian";
import { describeKdf } from "../crypto/kdf.ts";
import type { SealboxHost } from "../host.ts";
import { t } from "../i18n/index.ts";
import { sanitizeVaultPath, type LanguageSetting } from "../settings.ts";
import { DiagnosticsModal } from "./diagnostics.ts";
import { EnterRecoveryKeyModal, ShowRecoveryKeyModal } from "./recovery-modals.ts";
import { runAction, runQuietly } from "./run.ts";

export class SealboxSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    plugin: Plugin,
    private host: SealboxHost,
  ) {
    super(app, plugin);
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName(t("settings.interface")).setHeading();

    new Setting(containerEl)
      .setName(t("settings.language.name"))
      .setDesc(t("settings.language.desc"))
      .addDropdown((drop) =>
        drop
          .addOptions({
            auto: t("settings.language.auto"),
            // Language names stay in their own language, as they should: someone
            // looking for Russian in an English UI is looking for "Русский".
            en: "English",
            ru: "Русский",
          })
          .setValue(this.host.settings.language)
          .onChange(async (value) => {
            this.host.settings.language = value as LanguageSetting;
            await this.host.saveSettings();
            this.host.applyLanguage();
            // Redraw this tab so the change is visible immediately rather than
            // only the next time settings are opened.
            this.display();
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.ribbon.name"))
      .setDesc(t("settings.ribbon.desc"));

    for (const [key, label] of [
      ["ribbonSecrets", t("settings.ribbon.secrets")],
      ["ribbonLock", t("settings.ribbon.lock")],
      ["ribbonQuickAdd", t("settings.ribbon.quickAdd")],
      ["ribbonEncrypt", t("settings.ribbon.encrypt")],
    ] as const) {
      new Setting(containerEl).setName(label).addToggle((toggle) =>
        toggle.setValue(this.host.settings[key]).onChange(async (value) => {
          this.host.settings[key] = value;
          await this.host.saveSettings();
          this.host.refreshRibbon();
        }),
      );
    }

    new Setting(containerEl)
      .setName(t("settings.richEditor.name"))
      .setDesc(t("settings.richEditor.desc"))
      .addToggle((toggle) =>
        toggle.setValue(this.host.settings.richEditor).onChange(async (value) => {
          this.host.settings.richEditor = value;
          await this.host.saveSettings();
        }),
      );

    new Setting(containerEl).setName(t("settings.security")).setHeading();

    new Setting(containerEl)
      .setName(t("settings.autoLock.name"))
      .setDesc(t("settings.autoLock.desc"))
      .addText((text) =>
        text.setValue(String(this.host.settings.autoLockMinutes)).onChange(async (value) => {
          const minutes = Number(value);
          if (!Number.isFinite(minutes) || minutes < 0) return;
          this.host.settings.autoLockMinutes = Math.round(minutes);
          await this.host.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(t("settings.lockOnBlur.name"))
      .setDesc(t("settings.lockOnBlur.desc"))
      .addToggle((toggle) =>
        toggle.setValue(this.host.settings.lockOnBlur).onChange(async (value) => {
          this.host.settings.lockOnBlur = value;
          await this.host.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(t("settings.clipboard.name"))
      .setDesc(t("settings.clipboard.desc"))
      .addText((text) =>
        text
          .setValue(String(this.host.settings.clipboardClearSeconds))
          .onChange(async (value) => {
            const seconds = Number(value);
            if (!Number.isFinite(seconds) || seconds < 0) return;
            this.host.settings.clipboardClearSeconds = Math.round(seconds);
            await this.host.saveSettings();
          }),
      );

    new Setting(containerEl).setName(t("settings.encryption")).setHeading();

    new Setting(containerEl)
      .setName(t("settings.kdf.name"))
      .setDesc(t("settings.kdf.desc"))
      .addDropdown((drop) =>
        drop
          .addOptions({
            auto: t("settings.kdf.auto"),
            desktop: t("settings.kdf.desktop"),
            mobile: t("settings.kdf.mobile"),
            pbkdf2: t("settings.kdf.pbkdf2"),
          })
          .setValue(this.host.settings.kdfProfile)
          .onChange(async (value) => {
            this.host.settings.kdfProfile = value as typeof this.host.settings.kdfProfile;
            await this.host.saveSettings();
            this.display();
          }),
      );

    const kdfNote = containerEl.createDiv({ cls: "setting-item-description" });
    runQuietly("describe kdf", async () => {
      const params = await this.host.controller.kdfParams();
      kdfNote.setText(t("settings.kdf.onThisDevice", { kdf: describeKdf(params) }));
    });

    new Setting(containerEl)
      .setName(t("settings.cascade.name"))
      .setDesc(t("settings.cascade.desc"))
      .addToggle((toggle) =>
        toggle.setValue(this.host.settings.cascade).onChange(async (value) => {
          this.host.settings.cascade = value;
          await this.host.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(t("settings.verify.name"))
      .setDesc(t("settings.verify.desc"))
      .addToggle((toggle) =>
        toggle.setValue(this.host.settings.verifyAfterSeal).onChange(async (value) => {
          this.host.settings.verifyAfterSeal = value;
          await this.host.saveSettings();
          if (!value) new Notice(t("settings.verify.warning"), 10000);
        }),
      );

    new Setting(containerEl)
      .setName(t("settings.original.name"))
      .addDropdown((drop) =>
        drop
          .addOptions({
            trash: t("settings.original.trash"),
            permanent: t("settings.original.permanent"),
            keep: t("settings.original.keep"),
          })
          .setValue(this.host.settings.originalHandling)
          .onChange(async (value) => {
            this.host.settings.originalHandling =
              value as typeof this.host.settings.originalHandling;
            await this.host.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.mobileLimit.name"))
      .setDesc(t("settings.mobileLimit.desc"))
      .addText((text) =>
        text.setValue(String(this.host.settings.maxMobileMiB)).onChange(async (value) => {
          const mib = Number(value);
          if (!Number.isFinite(mib) || mib < 1) return;
          this.host.settings.maxMobileMiB = Math.round(mib);
          await this.host.saveSettings();
        }),
      );

    new Setting(containerEl).setName(t("settings.secrets")).setHeading();

    new Setting(containerEl)
      .setName(t("settings.secretsPath.name"))
      .setDesc(t("settings.secretsPath.desc"))
      .addText((text) =>
        text.setValue(this.host.settings.secretsPath).onChange(async (value) => {
          // Same sanitiser the settings loader uses: a typed path must not be
          // able to escape the vault with `..` or an absolute prefix.
          const sanitized = sanitizeVaultPath(value);
          if (!sanitized) return;
          this.host.settings.secretsPath = sanitized.endsWith(".sealed")
            ? sanitized
            : `${sanitized}.sealed`;
          await this.host.saveSettings();
        }),
      );

    new Setting(containerEl).setName(t("settings.access")).setHeading();

    new Setting(containerEl)
      .setName(t("settings.changePassword.name"))
      .setDesc(t("settings.changePassword.desc"))
      .addButton((button) =>
        button
          .setButtonText(t("common.change"))
          .onClick(() =>
            runAction("change master password", async () => {
              const rotated = await this.host.controller.changePassword();
              // A password change revokes the old recovery key, so the
              // replacement has to be put in front of the user immediately.
              if (rotated) new ShowRecoveryKeyModal(this.app, rotated).open();
              this.display();
            }),
          ),
      );

    // Whether a recovery key exists can only be answered after reading the
    // keyring, so the row is built first and filled in when the answer arrives.
    // Guessing "none" here would tell the user the opposite of the truth on the
    // one screen where that matters most.
    const recoveryRow = new Setting(containerEl)
      .setName(t("settings.recovery.name"))
      .setDesc(t("settings.recovery.checking"));
    recoveryRow.addButton((button) => {
      button
        .setButtonText(t("common.create"))
        .setCta()
        .onClick(() =>
          runAction("create recovery key", async () => {
            const display = await this.host.controller.createRecoveryKey();
            if (display) new ShowRecoveryKeyModal(this.app, display).open();
            this.display();
          }),
        );
      runQuietly("check recovery key", async () => {
        const exists = await this.host.controller.hasRecoveryKey();
        recoveryRow.setDesc(
          exists ? t("settings.recovery.exists") : t("settings.recovery.missing"),
        );
        button.setButtonText(exists ? t("settings.recovery.createNew") : t("common.create"));
      });
    });

    new Setting(containerEl)
      .setName(t("settings.forgot.name"))
      .setDesc(t("settings.forgot.desc"))
      .addButton((button) =>
        button
          .setButtonText(t("settings.forgot.button"))
          .onClick(() => new EnterRecoveryKeyModal(this.app, this.host, "reset").open()),
      );

    new Setting(containerEl).setName(t("settings.diagnostics")).setHeading();

    new Setting(containerEl)
      .setName(t("settings.selfTest.name"))
      .setDesc(t("settings.selfTest.desc"))
      .addButton((button) =>
        button
          .setButtonText(t("common.run"))
          .setCta()
          .onClick(() => new DiagnosticsModal(this.app, this.host).open()),
      );

    containerEl.createDiv({
      cls: "setting-item-description sealbox-threat-model",
      text: t("settings.threatModel"),
    });
  }
}
