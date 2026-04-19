# The Mishra Ventures — File Structure

## Folder Layout

```
public_html/                          ← your hosting root (upload everything inside here)
│
├── index.html                        ← bare domain redirect → mishra-ventures/
│
└── mishra-ventures/                  ← all Mishra Ventures code lives here
    │
    ├── index.html                    ← main hub landing page (venture cards)
    │
    ├── shared/                       ← shared assets used across ALL sub-sites
    │   ├── global.css                ← brand tokens, resets
    │   ├── logo.svg                  ← (add your logo here)
    │   └── favicon.ico               ← (add favicon here)
    │
    ├── aem-hub/                      ← AEM Dev Blog venture
    │   ├── index.html                ← blog listing page
    │   ├── articles/                 ← one .html file per article
    │   │   └── sling-models-done-right.html   ← example article
    │   └── assets/                   ← images/css specific to AEM hub
    │
    └── mishra-farms/                 ← Farm Direct Store venture
        ├── index.html                ← farm landing & order page
        └── assets/                   ← images specific to farm site


## URLs on your domain

  themishraventures.com/                          → redirects to hub
  themishraventures.com/mishra-ventures/          → hub (venture cards)
  themishraventures.com/mishra-ventures/aem-hub/  → AEM blog
  themishraventures.com/mishra-ventures/mishra-farms/ → farm store


## Adding a NEW venture later

  1. Create a new folder: public_html/mishra-ventures/your-new-venture/
  2. Add index.html inside it
  3. Link to ../shared/global.css for brand tokens
  4. Add a card for it in mishra-ventures/index.html


## Relative path reference (within each sub-site)

  From aem-hub/index.html:
    ../shared/global.css     → shared CSS
    ../                      → back to hub
    articles/my-article.html → article page

  From mishra-farms/index.html:
    ../shared/global.css     → shared CSS
    ../                      → back to hub


## TODOs before going live

  [ ] Replace WhatsApp number in mishra-farms/index.html
      (search for 919999999999 and replace with your real number)
  [ ] Add your logo.svg to shared/
  [ ] Add favicon.ico to shared/ and link it in each <head>
  [ ] Set up a form backend (e.g. Formspree) for the order/subscribe forms
  [ ] Write your first real AEM article in aem-hub/articles/
```
