# Оформление SealBox для GitHub

Первая концепция: геометрическая коробка с пломбой, тёмный сливовый фон, светлая типографика и лавандовый акцент. Все изображения оригинальные, выполнены в SVG без внешних ресурсов, скриптов и встроенных растров. Это иллюстрации возможностей и архитектуры, а не скриншоты интерфейса или результаты измерений.

## Файлы

- `assets/hero-en.svg`, `assets/hero-ru.svg` — обложки README, 1440 × 640.
- `assets/logo.svg` — знак на тёмном сливовом фоне, 256 × 256.
- `assets/logo-transparent.svg` — знак с прозрачным внешним фоном, 224 × 224.
- `assets/features-en.svg`, `assets/features-ru.svg` — карточки возможностей, 1440 × 590.
- `assets/encryption-en.svg`, `assets/encryption-ru.svg` — упрощённая схема ключей и шифрования, 1440 × 790.
- `assets/social-preview.svg` и `assets/social-preview.png` — изображение для превью репозитория, 1280 × 640.
- `preview.png` — контактный лист для быстрого просмотра.
- `README.en.md`, `README.ru.md` — готовые варианты публичного описания. Их ссылки работают из текущего каталога.

## Вставка в существующий README

Из корня репозитория:

```markdown
![SealBox](docs/branding/assets/hero-en.svg)
![Features](docs/branding/assets/features-en.svg)
![Encryption overview](docs/branding/assets/encryption-en.svg)
```

Для русского варианта замените `-en` на `-ru`. У всех SVG собственный непрозрачный фон, поэтому внешний вид не зависит от темы GitHub.

Исходный технический README сохранён в `docs/TECHNICAL.md`. Главные страницы `README.md` и `README.ru.md` используют новое оформление. Если переносить подготовленный текст в корень, измените `assets/` на `docs/branding/assets/`, а ссылки `../../` на пути от корня. Для двух языков можно оставить оба файла в этом каталоге и добавить ссылки из основного README.

PNG `assets/social-preview.png` можно загрузить в настройках репозитория как social preview. Файлы пока созданы только локально, публикация не выполнялась.

## Короткое описание для GitHub About

**EN:** Encrypt notes, attachments and secrets inside Obsidian. Local encryption, recovery keys, desktop and Android support.

**RU:** Шифрование заметок, вложений и секретов в Obsidian. Локальная обработка, ключи восстановления, поддержка компьютеров и Android.

Возможные темы: `obsidian-plugin`, `encryption`, `privacy`, `aes-gcm`, `argon2id`, `notes`, `password-manager`.

## Промпт для дальнейших вариантов

Create an original vector brand illustration for “SealBox”, an open-source Obsidian plugin for encrypting notes, attachments and secrets locally. Use a geometric sealed box as the central symbol: an isometric cube with a folded lavender security seal crossing its top and front. Restrained editorial composition, flat vector shapes, precise outlines, generous negative space. Palette: dark plum #171225, violet panel #241C36, borders #48365F, soft white #F5F0FF, secondary text #BFB1D2, lavender accent #C4A0FF. Use a harmonious purple palette to complement Obsidian. No Obsidian logo, no existing brand marks, no padlock clip art, no hacker imagery, no photographic textures, no 3D rendering. Wide 1440×640 composition with left space for a wordmark and short tagline; box symbol on the right. Deliver editable SVG paths if supported; otherwise produce a clean flat illustration suitable for manual vector tracing. Add the exact wordmark “SealBox” only if text rendering is reliable. Tagline: “Your vault. Your private space.”

Генератор растровых изображений сам по себе не гарантирует векторный результат. Файлы из этого набора уже являются настоящими SVG; промпт нужен для поиска следующих концепций.

## Редактирование

Изменения палитры, размеров и надписей: `generate.py`. Пересоздание: `python docs/branding/generate.py` из корня репозитория. Шрифт: DejaVu Sans с резервным Arial/sans-serif; текст остаётся редактируемым. При открытии на системе без DejaVu Sans возможна замена шрифта; PNG-превью фиксирует текущий вид.

Заимствован принцип подачи из https://github.com/Enthalpiex/Eccirian-Encrypt — обложка, возможности, отдельная схема шифрования. Графика и тексты созданы для SealBox; материалы референса не копировались.
