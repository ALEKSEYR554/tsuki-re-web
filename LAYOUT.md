# Раскладка TsukiRe-web: что где лежит

Плеер состоит из трёх мест. В git живёт только код; всё остальное —
вне репозитория. Этот файл — для тех, кто клонирует репозиторий
и поднимает свой экземпляр.

## 1. Код — git-репозиторий (корень = корень сайта)

То, что клонируется и обновляется через `git pull`:

- `index.html`, `style.css` — точка входа и стили
- `js/` — весь код плеера
- `data/` — ТОЛЬКО `*.json` (таблицы изображений, моций, grades,
  haze, flow, music, bgm_loops, flow_marks, motions). Никаких `.webp`!
- `fonts/` — шрифт сообщений (48 КБ, это не картинка, грузится
  через `@font-face` относительным путём)
- `manifest.json` — настоящий файл (не симлинк)
- `deploy/` — nginx-конфиг, `update.sh`, шаблон `media-base.json`
- `README.md`, `MOVIE_FILES.md`, `LAYOUT.md` (этот файл)
- `.gitignore` — отсекает всё из раздела 2, даже если оно лежит
  рядом локально: `assets/`, `scenes/`, `*.mp4`, `*.webp`,
  `/media-base.json`

## 2. Медиа — корень media-домена (или папка media-сервера)

Структура повторяет пути, которые плеер запрашивает через
`mediaBase`. Если `mediaBase` не задан, те же пути резолвятся
относительно кода (режим локальной разработки).

- `assets/img/` — игровые изображения (12 324 webp)
- `assets/bgm/` — BGM, нумерованные `.ogg`
- `assets/se/` — SE (имена из BFSAR, uppercase)
- `assets/voice/` — голоса
- `assets/movie/` — `.mp4` (46 базовых + 30 `_en`; какие именно —
  см. `MOVIE_FILES.md`)
- `scenes/` — JSON-паки сцен (549 шт.)
- `data/` — ТОЛЬКО `.webp` UI-текстур, зеркало структуры из кода:
  - `data/title/` — bg1, lumi, menu, logo, copy, particles
  - `data/parts/` — notice (parts_2_0)
  - `data/caution/` — caution_en, caution1_en
  - `data/conf/` — conf_faceicon, conf_name_en
  - `data/flow/` — фоны, линии, курсоры, панели и `thumbs/`
    (507 миниатюр флоучарта)
  - `data/border/` (12), `data/rules/` (49 `RULE_*.webp`),
    `data/noise/` (noisehd0/1), `data/focus/` (focusline)
  - `data/disp_*.webp` — полоса окна сообщений и иконки клика
  - `data/*.json` на media НЕ копировать — они в коде (раздел 1)

Откуда берутся media-файлы: распаковка `dist/` из RomFS
(`tools/build.py` + экстракторы UI-текстур `tools/extract_*.py`)
или готовый media-пак из релиза. В git их нет и не будет.

## 3. `media-base.json` — один файл в корне КОДА на сервере

НЕ входит в git (см. `.gitignore`). Копируется один раз при
установке из `deploy/media-base.json`:

```json
{"base": "https://media.tsuki-re.fate-custom-wars.ru/"}
```

- Без него плеер работает относительными путями: тогда
  `data/*.webp` должны лежать в `data/` рядом с кодом. Локально
  их можно просто держать на диске — git их игнорирует.
- С ним всё из раздела 2 запрашивается с media-домена, а
  кодовые запросы (`manifest.json`, `data/*.json`, `js/`,
  `fonts/`) остаются на кодовом домене.
- CORS: media-сервер обязан отдавать `Access-Control-Allow-Origin`
  только кодового домена (см. `deploy/nginx-tsukiweb.conf`) —
  иначе текстуры для canvas/WebGL не загрузятся (они грузятся
  с `crossOrigin="anonymous"`).

## Деплой по шагам

1. `git clone <repo> /var/www/tsuki-re/code`
2. Положить media в `/var/www/tsuki-re/media` по структуре
   из раздела 2
3. `cp deploy/media-base.json /var/www/tsuki-re/code/media-base.json`
   (и поправить `base`, если домен другой)
4. nginx по `deploy/nginx-tsukiweb.conf` + certbot на оба домена
5. Обновления: `git pull` в `code` (`deploy/update.sh`) —
   media при этом не трогается

## Локальная разработка

- Джанкшены/симлинки: `assets` → `../dist/assets`,
  `scenes` → `../dist/scenes`; `data/*.webp` лежат рядом —
  без `media-base.json` всё работает относительными путями.
- Проверка media-режима: положить `media-base.json` в корень
  кода с `base` на тестовый media-сервер и убедиться, что
  картинки (флоучарт, титул, окно сообщений) уходят на него.
