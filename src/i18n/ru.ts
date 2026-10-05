/**
 * Russian dictionary.
 *
 * Typed as `Record<MessageKey, Message>` against the English dictionary, so a
 * missing or misspelt key will not compile, and a test checks that the `{…}`
 * placeholders match English in every entry — a translation that silently drops
 * `{name}` would render a sentence with a hole in it.
 */

import type { Dictionary } from "./index.ts";

export const ru: Dictionary = {
  // --- общие надписи ------------------------------------------------------
  "common.cancel": "Отмена",
  "common.continue": "Продолжить",
  "common.unlock": "Разблокировать",
  "common.lock": "Заблокировать",
  "common.save": "Сохранить",
  "common.delete": "Удалить",
  "common.show": "Показать",
  "common.hide": "Скрыть",
  "common.copy": "Копировать",
  "common.generate": "Сгенерировать",
  "common.create": "Создать",
  "common.change": "Изменить",
  "common.run": "Запустить",
  "common.tryAgain": "Попробовать снова",
  "common.new": "Создать",
  "common.edit": "Правка",
  "common.preview": "Просмотр",
  "common.untitled": "(без названия)",

  // --- запрос пароля ------------------------------------------------------
  "password.field": "Пароль",
  "password.repeat": "Пароль ещё раз",
  "password.enter": "Введите пароль.",
  "password.mismatch": "Пароли не совпадают.",
  "password.strength": "Стойкость: {label} (~{bits} бит)",

  "strength.empty": "пусто",
  "strength.weak": "слабый — не используйте для настоящих данных",
  "strength.fair": "средний — лучше взять длинную парольную фразу",
  "strength.good": "хороший",
  "strength.strong": "надёжный",

  // --- первая настройка, разблокировка, смена пароля ----------------------
  "setup.title": "Создайте мастер-пароль Sealbox",
  "setup.description":
    "Один пароль защищает всё. Он растягивается через {kdf} и нигде не сохраняется — если его забыть, вернуть файлы сможет только recovery key.",
  "setup.submit": "Создать",
  "setup.done": "Sealbox настроен и разблокирован.",

  "unlock.title": "Разблокировать Sealbox",
  "unlock.kdf": "Функция вывода ключа: {kdf}.",
  "unlock.throttled": {
    one: "{count} неудачная попытка — следующая будет задержана на {seconds} с.",
    few: "{count} неудачные попытки — следующая будет задержана на {seconds} с.",
    many: "{count} неудачных попыток — следующая будет задержана на {seconds} с.",
  },
  "unlock.wrongPassword": "Неверный мастер-пароль.",
  "vault.locked": "хранилище заблокировано",

  "keyring.conflict": {
    one: "У keyring возник конфликт синхронизации ({count} лишняя копия). Разберите его вручную, прежде чем менять keyring: выбор не той копии лишит доступа ко всем зашифрованным файлам.",
    few: "У keyring возник конфликт синхронизации ({count} лишние копии). Разберите его вручную, прежде чем менять keyring: выбор не той копии лишит доступа ко всем зашифрованным файлам.",
    many: "У keyring возник конфликт синхронизации ({count} лишних копий). Разберите его вручную, прежде чем менять keyring: выбор не той копии лишит доступа ко всем зашифрованным файлам.",
  },

  "password.current.title": "Текущий мастер-пароль",
  "password.new.title": "Новый мастер-пароль",
  "password.new.description":
    "Перезаписывается только keyring — зашифрованные файлы не затрагиваются, поэтому это занимает мгновение, а не час.",
  "password.new.submit": "Сменить пароль",
  "password.changed": "Мастер-пароль изменён.",
  "password.new.revokesRecovery":
    "Текущий recovery key перестанет работать. Сразу после смены будет создан и показан новый — записать нужно будет его.",
  "recovery.rotated":
    "Старый recovery key больше не открывает хранилище. Вот новый — запишите его сейчас.",
  "password.changeFailed": "Не удалось сменить пароль: {error}",

  // --- восстановление доступа ---------------------------------------------
  "recovery.confirmPassword.title": "Подтвердите мастер-пароль",
  "recovery.confirmPassword.description":
    "Нужен, чтобы завернуть мастер-ключ под новый recovery key.",
  "recovery.createFailed": "Не удалось создать recovery key: {error}",
  "recovery.unlocked": "Разблокировано через recovery key. Задайте новый пароль.",
  "recovery.passwordReset": "Мастер-пароль сброшен. Зашифрованные файлы не изменились.",
  "recovery.newPassword.submit": "Задать пароль",

  "recovery.show.title": "Запишите recovery key",
  "recovery.show.body":
    "Это единственное, что откроет хранилище, если вы забудете мастер-пароль. Он показывается один раз и нигде не сохраняется.",
  "recovery.show.warning":
    "Любой, у кого есть этот ключ, получает полный доступ ко всем зашифрованным файлам. Относитесь к нему как к самому паролю: на бумаге в надёжном месте или зашифрованным отдельно от этого хранилища.",
  "recovery.show.copied": "Скопировано. Сохраните в надёжное место и очистите буфер обмена.",
  "recovery.show.copyFailed": "Буфер обмена недоступен — перепишите вручную.",
  "recovery.show.confirmPrompt": "Теперь введите его обратно, чтобы подтвердить, что он у вас есть:",
  "recovery.show.matches": "✓ совпадает",
  "recovery.show.noMatch": "пока не совпадает",
  "recovery.show.done": "Я записал его",
  "recovery.show.notConfirmed":
    "Recovery key сохранён в keyring, но вы не подтвердили, что записали его. Если он потерян — создайте новый в настройках Sealbox.",

  "recovery.enter.resetTitle": "Сброс мастер-пароля",
  "recovery.enter.unlockTitle": "Разблокировка через recovery key",
  "recovery.enter.resetBody":
    "Введите recovery key, затем задайте новый мастер-пароль. Зашифрованные файлы при этом не перешифровываются.",
  "recovery.enter.unlockBody": "Введите recovery key, чтобы разблокировать эту сессию.",
  "recovery.enter.resetAction": "Сбросить пароль",
  "recovery.placeholder": "XXXXX-XXXXX-XXXXX-…",

  // --- вьюшка зашифрованного файла ----------------------------------------
  "view.copyLink": "Копировать ссылку",
  "view.sealedFile": "Зашифрованный файл",
  "view.lockedSubtitle":
    "Зашифрованный файл · {size} на диске. Настоящее имя и тип находятся внутри шифртекста.",
  "view.noPassword":
    "Нет пароля? Без него здесь ничего не прочитать — просто откройте другую заметку. Если пароль потерян, выполните «{command}» из палитры команд.",
  "view.meta": "{mime} · {size}",
  "view.status.unsaved": "есть несохранённые правки",
  "view.status.saving": "сохранение…",
  "view.status.saved": "сохранено",
  "view.status.savedAt": "сохранено в {time}",
  "view.savedNotice": "Сохранено.",
  "view.status.notSaved": "НЕ сохранено",
  "view.saveFailed": "Sealbox не смог сохранить: {error}",
  "view.notUtf8": "(это не корректный текст в UTF-8)",
  "view.noViewer":
    "Для {mime} встроенного просмотра нет. Файл цел — используйте «{command}», если он нужен вам вне Obsidian.",
  "view.renderingPdf": "Отрисовка PDF…",
  "view.pdfFailed": "Этот PDF не удалось показать: {error}",
  "view.pdfDiagnosticsHint":
    "Выполните «{command}», чтобы проверить, работает ли отрисовка PDF на этом устройстве.",

  "viewer.image.unsupported":
    "Расшифрованные данные не являются изображением, которое эта платформа умеет показывать.",
  "viewer.pdf.pageLimit": "В этом PDF {total} страниц; показаны первые {shown}.",
  "viewer.pdf.pages": {
    one: "{count} страница",
    few: "{count} страницы",
    many: "{count} страниц",
  },
  "viewer.pdf.pagesZoom": "{pages} · {percent}%",
  "viewer.pdf.pagePlaceholder": "Страница {page}",
  "viewer.pdf.pageFailed": "Страницу {page} не удалось отрисовать.",

  // --- шифрование и расшифровка файлов ------------------------------------
  "ops.alreadySealed": "{name} уже зашифрован.",
  "ops.sealing": "Шифрование {name} — {done} из {total}",
  "ops.verifying": "Проверка {name}…",
  "ops.verifyFailed":
    "проверка {path} не прошла — оригинал НЕ удалён. Пожалуйста, сообщите об этом.",
  "ops.keptOriginal":
    "{name} зашифрован, но открытый оригинал оставлен — он по-прежнему читается и по-прежнему синхронизируется.",
  "ops.mobileTrashNote":
    "На мобильном оригинал удаляется сразу, а не в корзину: локальная корзина лежит внутри хранилища и продолжала бы синхронизировать читаемую копию.",
  "ops.sweptLocalTrash":
    "Системная корзина была недоступна, поэтому Sealbox удалил открытую копию {name} из локальной корзины хранилища, чтобы она не ушла в синхронизацию.",
  "ops.mobileSizeLimit":
    "{name} занимает {size}, это больше мобильного лимита {limit} МиБ. Сделайте это на компьютере или поднимите лимит в настройках Sealbox, если устройство выдержит.",
  "ops.folderEmpty": "В этой папке нечего шифровать.",
  "ops.folderStart": {
    one: "Шифрование {count} файла…",
    few: "Шифрование {count} файлов…",
    many: "Шифрование {count} файлов…",
  },
  "ops.folderProgress": "Шифрование {index}/{total}: {name}",
  "ops.folderDone": {
    one: "Зашифрован {count} файл.",
    few: "Зашифровано {count} файла.",
    many: "Зашифровано {count} файлов.",
  },
  "ops.folderDoneWithFailures":
    "Зашифровано файлов: {done}, пропущено: {failed}. Для пропущенных ничего не удалялось.",
  "ops.skipped": "Пропущен {name}: {error}",

  // --- команды, меню, уведомления -----------------------------------------
  "command.unlock": "Разблокировать",
  "command.lock": "Заблокировать сейчас",
  "command.sealActive": "Зашифровать текущий файл",
  "command.decryptPermanently": "Расшифровать навсегда (вернёт открытый файл в хранилище)",
  "command.newSealedNote": "Новая зашифрованная заметка",
  "command.openSecrets": "Открыть пароли",
  "command.quickAdd": "Новая запись в паролях",
  "command.mergeConflicts": "Слить конфликты синхронизации в базе паролей",
  "command.recoverAccess": "Восстановить доступ через recovery key",
  "command.copyFileLink": "Копировать ссылку на текущий зашифрованный файл",
  "command.diagnostics": "Диагностика",

  "menu.seal": "Sealbox: зашифровать",
  "menu.sealFolder": "Sealbox: зашифровать эту папку",
  "menu.newNoteHere": "Sealbox: новая зашифрованная заметка здесь",
  "menu.copyLink": "Sealbox: копировать ссылку на файл",
  "menu.decrypt": "Sealbox: расшифровать навсегда",
  "ribbon.secrets": "Пароли Sealbox",
  "ribbon.quickAdd": "Новая запись Sealbox",
  "ribbon.encrypt.ready": "Зашифровать {name}",
  "ribbon.encrypt.alreadySealed": "{name} уже зашифрован",
  "ribbon.decrypt.ready": "Снять шифрование с {name} — запишет открытый файл",
  "ribbon.encrypt.noFile": "Откройте файл, чтобы зашифровать его",
  "notice.openFileFirst": "Сначала откройте файл, который нужно зашифровать.",
  "statusbar.unlocked": "Sealbox разблокирован — нажмите, чтобы заблокировать",
  "statusbar.locked": "Sealbox заблокирован — нажмите, чтобы разблокировать",

  "notice.locked": "Sealbox заблокирован.",
  "notice.extensionTaken":
    "Sealbox не смог занять расширение .{ext} — возможно, его уже обслуживает другой плагин.",
  "notice.restored": {
    one: "Sealbox восстановил {count} файл после прерванной записи.",
    few: "Sealbox восстановил {count} файла после прерванной записи.",
    many: "Sealbox восстановил {count} файлов после прерванной записи.",
  },
  "notice.fileLinkCopied": "Ссылка скопирована: {link}",
  "notice.sealedAs": "Зашифровано в {path}",
  "notice.undo": "Отменить",
  "notice.undone": "Шифрование снято — {name} снова читается.",
  "notice.undoUnavailable":
    "Sealbox больше не находит этот файл. Примените к нему «{command}» вручную.",
  "notice.sealFailed": "Не удалось зашифровать {name}: {error}",
  "notice.decryptedTo": "Расшифровано в {path} — теперь этот файл читается чем угодно.",
  "notice.decryptFailed": "Не удалось расшифровать {name}: {error}",
  "notice.createNoteFailed": "Не удалось создать зашифрованную заметку: {error}",
  "notice.createdNote": "Создано: {path}. Откройте из списка файлов.",
  "notice.noConflicts": "Конфликтов синхронизации не найдено.",

  "confirm.decrypt.title": "Расшифровать {name}?",
  "confirm.decrypt.body":
    "Это вернёт читаемый файл в хранилище.\n\ngit и Syncthing подхватят его, скопируют на другие устройства и сохранят в истории — откуда позднее удаление его уже не уберёт.",
  "confirm.decrypt.warning": "Делайте это только если файл действительно нужен вне Obsidian.",
  "confirm.decrypt.action": "Расшифровать навсегда",
  "chip.secret": "🔑 пароль",

  // --- менеджер паролей ---------------------------------------------------
  "secrets.searchPlaceholder": "Поиск по названию, логину, ссылке, заметке, тегам…",
  "secrets.groups": "Группы",
  "secrets.all": "Все",
  "secrets.allEntries": "Все записи",
  "secrets.ungrouped": "Без группы",
  "secrets.empty": "Записей пока нет. Нажмите «Создать».",
  "secrets.noMatch": "Ничего не найдено.",
  "secrets.selectEntry": "Выберите запись или нажмите «Создать».",
  "secrets.backGroups": "‹ Группы",
  "secrets.backEntries": "‹ Записи",
  "quickAdd.title": "Новая запись · {template}",
  "quickAdd.saved": "«{title}» добавлена в пароли.",
  "secrets.template.choose": "Какая это запись?",
  "secrets.template.site": "Сайт",
  "secrets.template.siteDesc": "Страница входа, логин и пароль.",
  "secrets.template.card": "Банковская карта",
  "secrets.template.cardDesc": "Номер, срок действия, CVC и держатель.",
  "secrets.template.server": "Сервер / SSH",
  "secrets.template.serverDesc": "Хост, порт и ключ.",
  "secrets.template.custom": "Пустая",
  "secrets.template.customDesc": "Только базовые поля, остальное добавите сами.",

  "secrets.field.links": "Ссылки",
  "secrets.field.addLink": "Добавить ссылку",
  "secrets.field.noLinks": "Ссылок пока нет.",
  "secrets.field.extra": "Дополнительные поля",
  "secrets.field.addExtra": "Добавить поле",
  "secrets.field.labelPlaceholder": "Название поля",
  "secrets.field.valuePlaceholder": "Значение",
  "secrets.field.secretToggle": "Скрывать",
  "secrets.open": "Открыть",
  "secrets.remove": "Удалить",

  "secrets.label.cardNumber": "Номер карты",
  "secrets.label.cardExpiry": "Срок действия",
  "secrets.label.cardCvc": "CVC",
  "secrets.label.cardHolder": "Держатель",
  "secrets.label.host": "Хост",
  "secrets.label.port": "Порт",
  "secrets.label.sshKey": "SSH-ключ",

  "secrets.field.title": "Название",
  "secrets.field.group": "Группа",
  "secrets.field.username": "Логин",
  "secrets.field.password": "Пароль",
  "secrets.field.url": "Ссылка",
  "secrets.field.tags": "Теги (через запятую)",
  "secrets.field.note": "Заметка",
  "secrets.generatorInfo": "Генератор: {length} символов, ~{bits} бит",
  "secrets.openUrl": "Открыть ссылку",
  "secrets.copyUsername": "Копировать логин",
  "secrets.onlyHttp": "Открывать можно только ссылки http и https.",
  "secrets.history": {
    one: "Прошлый пароль ({count})",
    few: "Прошлые пароли ({count})",
    many: "Прошлые пароли ({count})",
  },
  "secrets.timestamps": "Создано {created} · изменено {updated}",
  "secrets.copyLink": "Копировать ссылку для заметки",
  "secrets.linkCopied": "Вставьте это в заметку, чтобы сослаться на эту запись.",
  "secrets.clipboardUnavailable": "Буфер обмена здесь недоступен.",
  "secrets.newEntryTitle": "Новая запись",
  "secrets.saved": "Сохранено.",
  "secrets.saveFailed": "Sealbox не смог сохранить: {error}",
  "secrets.lockedClosed": "Sealbox заблокирован — окно паролей закрыто.",
  "secrets.delete.title": "Удалить эту запись?",
  "secrets.delete.body": "«{title}» будет удалена из базы паролей.",
  "secrets.delete.warning":
    "Из самого Sealbox это не отменить — только восстановлением контейнера .bak.",

  "store.unreadable":
    "База паролей расшифровалась корректно, но её содержимое не читается. Предыдущая версия может лежать по пути {path}.",
  "store.conflictUnreadable":
    "Sealbox не смог прочитать одну конфликтную копию ({name}). Она оставлена на месте.",
  "store.merged": {
    one: "Слит {count} конфликт синхронизации в базу паролей: новых записей — {added}.",
    few: "Слито {count} конфликта синхронизации в базу паролей: новых записей — {added}.",
    many: "Слито {count} конфликтов синхронизации в базу паролей: новых записей — {added}.",
  },
  "store.mergedConflicts":
    " Записей, изменённых на обоих устройствах: {edited}; победила более свежая правка ({titles}).",

  "clipboard.unavailable": "Эта платформа не дала Sealbox доступ к буферу обмена.",
  "clipboard.copiedNoClear":
    "Скопировано. Автоочистка отключена, поэтому пароль останется в буфере обмена.",
  "clipboard.copiedWithClear": "Скопировано — буфер обмена будет очищен через {seconds} с.",

  // --- настройки ----------------------------------------------------------
  "settings.interface": "Интерфейс",
  "settings.language.name": "Язык",
  "settings.language.desc":
    "«Как в Obsidian» берёт язык самого Obsidian. Названия команд меняются сразу.",
  "settings.language.auto": "Как в Obsidian",

  "settings.ribbon.name": "Иконки на боковой панели",
  "settings.ribbon.desc":
    "Какие иконки Sealbox показывать на левой панели. Иконки «расшифровать навсегда» здесь намеренно нет: это действие записывает читаемую копию обратно в хранилище, откуда git и Syncthing разнесут её и сохранят в истории, поэтому оно остаётся за правым кликом и подтверждением.",
  "settings.ribbon.secrets": "Пароли",
  "settings.ribbon.quickAdd": "Новая запись",
  "settings.ribbon.lock": "Заблокировать / разблокировать",
  "settings.ribbon.encrypt": "Зашифровать текущий файл",

  "settings.richEditor.name": "Полноценный редактор для зашифрованных заметок",
  "settings.richEditor.desc":
    "Использует ту же библиотеку CodeMirror, на которой построен редактор Obsidian: история undo, несколько курсоров, поиск по документу и подсветка Markdown. Но это не редактор Obsidian — живое превью, автодополнение [[ссылок]] и вложения живут в надстройке без публичного API, и получить их можно только дав Obsidian открыть расшифрованный файл на диске. Выключите, чтобы получить обычное текстовое поле.",

  "settings.security": "Безопасность",
  "settings.autoLock.name": "Автоблокировка через",
  "settings.autoLock.desc":
    "Минут простоя, после которых хранилище блокируется само, а все открытые зашифрованные файлы возвращаются на экран блокировки. 0 — выключить.",
  "settings.lockOnBlur.name": "Блокировать при потере фокуса Obsidian",
  "settings.lockOnBlur.desc":
    "Строже, но придётся вводить пароль каждый раз при переключении окон.",
  "settings.clipboard.name": "Очищать скопированные пароли через",
  "settings.clipboard.desc":
    "Секунд до очистки буфера обмена. 0 — оставлять пароль в буфере. Учтите: на Android другие приложения могут прочитать буфер, пока пароль в нём лежит.",

  "settings.encryption": "Шифрование",
  "settings.kdf.name": "Профиль вывода ключа",
  "settings.kdf.desc":
    "«Автоматически» выбирает Argon2id под возможности устройства и переходит на PBKDF2 там, где Argon2id не работает. Изменение влияет только на новые keyring и на файлы со своим собственным паролем — у существующих файлов параметры записаны внутри них.",
  "settings.kdf.auto": "Автоматически (рекомендуется)",
  "settings.kdf.desktop": "Argon2id 64 МиБ",
  "settings.kdf.mobile": "Argon2id 32 МиБ",
  "settings.kdf.pbkdf2": "Только PBKDF2-SHA512",
  "settings.kdf.onThisDevice": "На этом устройстве: {kdf}.",
  "settings.cascade.name": "Параноидальный режим (каскад)",
  "settings.cascade.desc":
    "Добавляет XChaCha20-Poly1305 поверх AES-256-GCM. Честная оценка: выигрыш почти нулевой — атакуют пароли, а не AES — а время шифрования и открытия файла примерно удваивается. Уже существующие файлы открываются в любом случае.",
  "settings.verify.name": "Проверять после шифрования",
  "settings.verify.desc":
    "Расшифровывать каждый свежезашифрованный файл и сравнивать с оригиналом, прежде чем оригинал будет удалён. Не отключайте.",
  "settings.verify.warning":
    "Проверка отключена. Теперь ошибка в Sealbox может удалить оригинал, зашифрованная копия которого не читается.",
  "settings.original.name": "После шифрования оригинал",
  "settings.original.trash": "Перемещается в системную корзину",
  "settings.original.permanent": "Удаляется сразу",
  "settings.original.keep": "Остаётся (читаемым и синхронизируемым)",
  "settings.mobileLimit.name": "Лимит размера на мобильном (МиБ)",
  "settings.mobileLimit.desc":
    "Отказываться шифровать и открывать файлы больше этого размера на телефоне или планшете, вместо того чтобы рисковать убийством приложения посреди записи.",

  "settings.secrets": "Пароли",
  "settings.secretsPath.name": "Путь к базе паролей",
  "settings.secretsPath.desc":
    "Зашифрованный контейнер внутри хранилища. Шифруется точно так же, как любой другой файл.",

  "settings.access": "Доступ и восстановление",
  "settings.changePassword.name": "Сменить мастер-пароль",
  "settings.changePassword.desc":
    "Перезаписывает только keyring, поэтому выполняется мгновенно и не трогает зашифрованные файлы.",
  "settings.recovery.name": "Recovery key",
  "settings.recovery.checking": "Проверка keyring…",
  "settings.recovery.exists":
    "Recovery key есть. Создание нового заменит его — старый перестанет работать.",
  "settings.recovery.missing":
    "Recovery key ещё нет. Без него забытый пароль означает, что файлы потеряны навсегда.",
  "settings.recovery.createNew": "Создать новый",
  "settings.forgot.name": "Забыли пароль?",
  "settings.forgot.desc": "Задать новый мастер-пароль через recovery key.",
  "settings.forgot.button": "Использовать recovery key",

  "settings.diagnostics": "Диагностика",
  "settings.selfTest.name": "Прогнать самопроверку на этом устройстве",
  "settings.selfTest.desc":
    "Проверяет WebCrypto, Argon2id, формат контейнера, пропускную способность и просмотр PDF. Отчёт не содержит содержимого хранилища, поэтому им можно делиться.",
  "settings.threatModel":
    "От чего это защищает: украденный ноутбук или телефон, утёкший git-репозиторий, копия папки Syncthing, облачный бэкап. От чего защитить не может: от вредоносного ПО, уже работающего на устройстве (оно снимет пароль при вводе), от других плагинов Obsidian и от забытого пароля без recovery key. Имена файлов, размеры и структура папок остаются видны; зашифровано только содержимое.",

  // --- диагностика --------------------------------------------------------
  "diag.title": "Диагностика Sealbox",
  "diag.intro":
    "Самопроверка собственного шифрования плагина на этом устройстве. В результатах не появляются ни заметки, ни имена файлов, ни пароли, поэтому отчётом можно делиться.",
  "diag.running": "Выполняется…",
  "diag.allPassed": "Все проверки на этом устройстве пройдены.",
  "diag.someFailed": {
    one: "Не пройдена {count} проверка: {names}.",
    few: "Не пройдено {count} проверки: {names}.",
    many: "Не пройдено {count} проверок: {names}.",
  },
  "diag.save": "Сохранить в {path}",
  "diag.copy": "Копировать отчёт",
  "diag.copied": "Отчёт скопирован.",
  "diag.copyFailed": "Буфер обмена здесь недоступен.",
  "diag.saved": "Сохранено: {path}.",
  "diag.saveFailed": "Не удалось записать файл отчёта.",

  "diag.check.platform": "Платформа",
  "diag.check.webcrypto": "WebCrypto AES-256-GCM",
  "diag.check.wasm": "WebAssembly",
  "diag.check.argon2": "Argon2id (выбранный профиль)",
  "diag.check.pbkdf2": "Запасной PBKDF2-SHA512",
  "diag.check.format": "Самопроверка формата контейнера",
  "diag.check.formatCascade": "Самопроверка формата контейнера (каскад)",
  "diag.check.throughput": "Пропускная способность",
  "diag.check.pdf": "Воркер PDF",
  "diag.check.editor": "Полноценный редактор",
  "diag.result.editorOk": "CodeMirror загружается из Obsidian и запускается здесь",
  "diag.error.editor": "CodeMirror недоступен, заметки откатятся на обычное текстовое поле ({error})",

  "diag.result.webcrypto": "AES-256-GCM шифрует и расшифровывает корректно",
  "diag.result.wasm": "WebAssembly компилируется и инициализируется",
  "diag.result.kdf": "{kdf} занял {ms} мс",
  "diag.result.format":
    "round-trip, отлов подмены и отлов обрезания — всё пройдено",
  "diag.result.formatCascade":
    "каскадный round-trip, отлов подмены и отлов обрезания — всё пройдено",
  "diag.result.throughput":
    "{size}: шифрование {sealMs} мс ({sealRate} МиБ/с), открытие {openMs} мс ({openRate} МиБ/с)",
  "diag.result.pdfOk":
    "воркер запустился и разобрал ввод (отверг некорректный тестовый ввод, как и ожидалось)",
  "diag.result.pdfLenient": "воркер запустился (и неожиданно принял тестовый ввод)",
  "diag.error.pdf": "воркер pdf.js не запустился: {error}",
  "diag.error.flippedBit": "перевёрнутый бит НЕ был обнаружен — не используйте эту сборку",
  "diag.error.truncation": "обрезание НЕ было обнаружено",

  "diag.report.generated": "Сформирован {timestamp}",
  "diag.report.colCheck": "Проверка",
  "diag.report.colResult": "Результат",
  "diag.report.colDetail": "Подробности",
  "diag.report.pass": "пройдена",
  "diag.report.fail": "НЕ ПРОЙДЕНА",
  "diag.report.footer":
    "Этот отчёт не содержит ни содержимого хранилища, ни имён файлов, ни ключевого материала.",

  // --- ошибки, видимые пользователю ---------------------------------------
  "error.actionFailed": "Sealbox не смог это выполнить: {error}",
  "notice.notSetUp":
    "Sealbox ещё не настроен. Зашифруйте файл или создайте recovery key — сначала будет предложено задать мастер-пароль.",
  "error.unknown": "произошла неизвестная ошибка",
  "error.generic": "Что-то пошло не так. Посмотрите экран диагностики Sealbox.",

  "crypto.wrongPassword": "неверный пароль, либо файл был изменён",
  "crypto.blockFailed":
    "файл повреждён или был изменён (блок {index} из {total} не прошёл проверку целостности)",
  "crypto.sizeMismatch": "размер расшифрованных данных не совпадает с метаданными",
  "crypto.wrongMasterPassword": "неверный мастер-пароль",
  "crypto.keyringDamagedMk":
    "пароль верный, но завёрнутый мастер-ключ повреждён — восстановите keyring из бэкапа или используйте recovery key",
  "crypto.keyringNoRecovery": "в этом keyring recovery key не настроен",
  "crypto.recoveryMismatch": "этот recovery key не подходит к данному хранилищу",
  "crypto.recoveryMalformed": "в слоте восстановления лежит некорректный мастер-ключ",
  "crypto.keyringNotJson":
    "keyring.json не является корректным JSON — восстановите его из бэкапа, прежде чем делать что-либо ещё",
  "crypto.keyringNotObject": "keyring не является объектом JSON",
  "crypto.keyringVersion": "версия keyring {version} не поддерживается этим плагином",
  "crypto.keyringMissingFields": "в keyring отсутствуют обязательные поля",
  "crypto.keyringBadBox": "keyring содержит некорректный блок",
  "crypto.keyringUnknownKdf": "keyring указывает неизвестную функцию вывода ключа",
  "crypto.keyringSaltShort": "соль keyring слишком короткая",
  "crypto.keyringBadNonce": "некорректный nonce в keyring",
  "crypto.keyringMkSize": "у завёрнутого мастер-ключа неверный размер",

  "recoveryKey.empty": "recovery key пуст",
  "recoveryKey.short": "recovery key слишком короткий",
  "recoveryKey.badChar": "недопустимый символ «{char}»",
  "recoveryKey.checksum": "в этом recovery key опечатка (контрольная сумма не сходится)",

  "container.tooShort": "файл слишком короткий, чтобы быть контейнером Sealbox",
  "container.notContainer": "это не контейнер Sealbox",
  "container.futureVersion":
    "формат контейнера v{version} новее, чем понимает этот плагин",
  "container.unknownFlags": "контейнер использует неизвестные флаги возможностей",
  "container.reservedNotEmpty": "резервные байты заголовка не пусты",
  "container.unknownKdf": "неизвестная функция вывода ключа",
  "container.vaultWithKdf":
    "контейнер на ключе хранилища не должен содержать параметры KDF",
  "container.chunkRange": "размер чанка вне допустимого диапазона",
  "container.metaRange": "длина метаданных вне допустимого диапазона",
  "container.truncatedMeta": "контейнер обрезан внутри метаданных",
  "container.implausibleArgon": "неправдоподобные параметры argon2id",
  "container.argonTooLarge": "запрошенная argon2id память неразумно велика",
  "container.pbkdf2WithArgon": "контейнер pbkdf2 содержит параметры argon2",
  "container.implausiblePbkdf2": "неправдоподобное число итераций pbkdf2",
  "container.kdfWithoutKdf": "параметры KDF присутствуют без самой KDF",
  "container.bodyTruncated": "тело контейнера обрезано",
  "container.implausibleChunks": "неправдоподобное число чанков",
  "container.payloadTooLarge": "полезная нагрузка слишком велика",
  "container.metaNotJson": "метаданные не являются корректным JSON",
  "container.metaNotObject": "метаданные не являются объектом",
  "container.metaVersion": "неподдерживаемая версия метаданных",
  "container.metaPathSeparator": "имя в метаданных содержит разделитель пути",
};
