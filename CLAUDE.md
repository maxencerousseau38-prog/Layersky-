# Projet — infrastructure de localisation développeur-first

## Invariants (ne jamais violer sans validation explicite)
1. Git est la source de vérité. Postgres = index/cache.
2. Premier livrable = pull request, jamais dashboard.
3. Aucune facturation au mot/caractère/relecteur. Abonnement fixe uniquement.
4. L'agent remonte les ambiguïtés, il ne les devine pas.
5. Résidence des données UE.

## État actuel

**Backend (fonctionne aujourd'hui)**
- `packages/eval` — harnais d'évaluation (Sprint 0). Corpus de 414 chaînes,
  contrôles déterministes placeholders/ICU/pluriels en CI.
- `packages/schemas` — contrats Zod partagés (CLI, API, web).
- `packages/core` + `packages/cli` — détection de framework, extraction AST,
  moteur de fusion des fichiers de locale, commande `init` (M1 Phase 1).
- `apps/api` (propriétaire) — `POST /v1/translate`, `POST /v1/open-pr`,
  auth bearer. **Plus « en local uniquement »** : déployé depuis le 2026-08-19,
  vérifié aujourd'hui — `/health` répond 200, `/v1/translate` répond 401 sans
  jeton.
- `services/github-app` (propriétaire) — ouverture de PR via Octokit.
- Validé de bout en bout **deux fois, et ce ne sont pas la même preuve.**
  Cette ligne portait la première : le CLI, contre un clone local. La seconde
  est le produit lui-même, le 2026-08-29 — depuis `/layersky/projects`, sans
  aucune intervention manuelle entre le bouton « Run pipeline » et la pull
  request. Run `b6fbbf11` : framework « Vite + React » détecté, 3 clés
  extraites, 12 traduites, 4 locales (`fr`, `de`, `ja`, `es`), 0 échec, PR #9
  ouverte sur `maxencerousseau38-prog/localize-infra-fixture-vite` en 22 s
  (21:32:30 → 21:32:52 UTC), fusionnée en squash le 2026-08-29 (`665b765`).
  C'est la seconde qui dit que le produit fonctionne ; la première ne disait
  que ça de la bibliothèque.

**Frontend**
- `packages/ui` (propriétaire) — tokens de design en 3 couches, primitives.
  Livré en **source**, pas en `dist` : un artefact compilé partagé entre
  paquets a déjà causé un bug de production ici (correctif de sécurité présent
  en source mais absent du build servi).
- `apps/site` (propriétaire) — site marketing statique, 7 pages.
  Contrainte permanente : **toute affirmation du site doit être vraie
  aujourd'hui.** `/quality` ne publie que les résultats vérifiés en CI et
  déclare que l'évaluation humaine n'a pas eu lieu ; `/pricing` ne publie pas
  de tarifs non modélisés ; `/security` divulgue l'écart de résidence UE.

  **La landing avait un héro à 68px et des titres de section à 24px, contre une
  prose à 17px** — un titre qui ne se classe pas contre son propre corps de
  texte, l'échec que `DESIGN.md` §3.5 nomme. Les sections emploient désormais
  `display`/`display-lg`, le palier que `PageHeader` et la bande de clôture
  utilisaient déjà ; l'échelle est 68 → 40 → 17 (#84). Le héro est passé à 500 :
  §3.3 bannit 700 parce qu'« à ces tailles cela lit comme un cri », et à 68px
  l'argument valait aussi pour 600.

  Deux règles du contrat sont passées de la discipline de revue au test. **§4.4**
  — aucune paire de sections adjacentes ne partage sa signature — était rédigée
  en forme testable et n'avait jamais été testée ; l'audit des sept sections n'a
  trouvé aucune violation, donc le test fige un état correct au lieu d'en
  corriger un mauvais. Et **le balayage responsive échantillonne 640** en plus de
  768 : l'en-tête débordait de 28px à cette largeur exacte, la frontière `sm` où
  la barre passait d'un coup de sa sheet à sa rangée desktop complète, et la
  liste allait de 390 à 768 en l'enjambant.

  La leçon transférable est celle-là, pas les pixels : **un point de bascule est
  l'endroit où une mise en page change, donc la largeur la plus susceptible
  d'être fausse et la moins susceptible d'être mesurée.**

  **`/docs` distribuait la seule commande qui ne peut pas marcher sous
  Windows** (#120, 2026-09-24). La première commande à copier de la page était
  `export LOCALIZE_API_TOKEN=…` ; `export` est une erreur de syntaxe sous
  PowerShell, le shell par défaut de Windows. Les deux dialectes sont
  désormais là, avec les libellés du produit, et une phrase donne la règle de
  traduction pour les blocs auto-hébergés plus bas.

  **Ce qui compte n'est pas le défaut mais qu'il avait déjà été corrigé.**
  `/[org]/start` l'a réglé en #102 — voir `apps/web` plus bas, avec un test qui
  épingle la forme `$env:`. Ce correctif, test compris, n'a jamais traversé
  jusqu'au site. La règle : **un correctif testé sur une surface ne dit rien
  d'une autre surface qui distribue la même instruction.** Le test de #102 lit
  `lib/onboarding/commands.ts` ; rien dans le dépôt ne lisait les deux.
  `grep -rn "export LOCALIZE" apps/` les montrait ensemble, en une commande.

  **Et le correctif en a produit un second, visible seulement à l'écran.**
  `CodeBlock.label` n'est qu'un `aria-label` : les deux blocs, qui ne diffèrent
  que par `export` contre `$env:`, arrivaient identiques pour un lecteur
  voyant, à charge pour lui de les comparer, pendant qu'un lecteur d'écran
  s'entendait dire lequel était lequel. **Un nom accessible qui porte une
  information que personne ne voit est un demi-libellé.** `showLabel` le rend,
  en opt-in. Trouvé dans la capture, pas dans le diff — le diff était correct.

  **Le rang des titres, mesuré et non jugé à l'œil.** `/docs` portait **trois**
  traitements de `h3` pour un seul niveau sémantique — 14/500, 14/600, 16/600 —
  dont deux sous la prose à 17px qu'ils introduisent, l'échec de §3.5 déjà
  nommé plus haut pour la landing. **Le premier correctif, à 16px, était encore
  faux** : 16 < 17. La page emploie trois tailles de corps (17 prose, 14 listes,
  12 messages de refus), donc le seul palier qui les surclasse toutes est 20px.
  La leçon n'est pas « 20 » : **le bon palier se déduit des tailles de corps que
  la page emploie réellement, et une page de documentation en emploie
  plusieurs.** Une sonde compare chaque `h3` à son propre corps de texte, sur
  les deux pages — **11 sur 11 classent, contre 8 sur 11 avant** : les deux de
  `/docs` déjà cités, plus celui de `/security`, qui était à égalité avec son
  corps de texte et non en dessous, ce qui ne classe pas davantage.

  **`/security` était la seule page du site à composer ses titres de section
  dans la police de texte** — sept `h2` en 20px Inter — alors que son propre
  bloc « Sub-processors », au milieu des autres, employait
  `font-display text-headline` comme les six autres pages. Le site a bien un
  système à deux étages, et `/security` appliquait l'étage « encadré » à son
  niveau supérieur. La page qui argumente que ce produit énonce les choses
  précisément était la moins établie typographiquement.

  **Le tableau Status omettait deux capacités qu'il promet de nommer.** Il
  affirme « The rest are named **here** rather than implied elsewhere » et
  laissait à `/roadmap` seul *Placeholder-aware extraction* et *Visual context
  capture*. Vérifié avant ajout plutôt que recopié : `packages/core/src/extract`
  ne contient aucune gestion de placeholder, et `/docs` dit que les chaînes dans
  les expressions JSX ne sont pas extraites. La première est celle que
  `/roadmap` place devant tout le reste. Le libellé d'état est par ailleurs
  `sr-only` sur les lignes livrées : huit « WORKING » identiques attiraient
  l'œil sur les lignes qui en avaient le moins besoin, et la coche jade porte
  déjà l'information par sa forme, donc §13 est satisfaite sans le mot.

  **`/pricing` portait le dernier « In development » du site**, pour une
  facturation dont le dépôt ne contient aucune ligne de Stripe — la landing
  disait « Not started » et la page tarifaire disait l'inverse, à deux clics.

  Vérifié en production après fusion : le déploiement **du commit** `9f0f702`
  existe (créé 61 s après la fusion, servi ~40 s plus tard), et les cinq pages
  portent leur modification dans le HTML réellement servi. `Age: 0` sur une
  première requête est un cache miss, pas une preuve de redéploiement.

  **La preuve centrale de la landing était un 404 pour tout visiteur.** « See
  the pull request it opened » pointait, à quatre endroits, vers la PR #1 du
  dépôt fixture — **privé**. Personne ne l'a vu parce que tous ceux qui
  vérifiaient étaient connectés à GitHub en tant que propriétaire. La PR était
  en outre fermée sans merge, et l'artefact affichait « #1 open » et « 22s »,
  une durée qu'aucune source ne rattachait à #1. L'artefact montre désormais le
  run `b6fbbf11` (PR #9, fusionnée, 21,1 s entre `runs.created_at` et
  l'ouverture de la PR — les « 22 s » écrits plus haut tronquent le départ), et
  `EXAMPLE_PR_URL` vaut `null` : les composants rendent les faits sans lien. Un
  test e2e interdit tout lien vers le fixture tant qu'il est `null`, vérifié
  non vacant. **Rendre le fixture public est le correctif en une ligne** —
  à contrôler déconnecté.

  Le même audit (2026-09-16) a trouvé le site en retard sur le produit dans
  l'autre sens : comptes, workspaces et projets déclarés « In development » ou
  inexistants alors que l'inscription est ouverte ; `/security` affirmant
  qu'aucune base hébergée n'existe et qu'elle ne stockerait « never your
  translations », alors que `run_translations` garde chaque proposition ;
  Supabase et Vercel absents des sous-traitants ; deux permissions de la GitHub
  App (`artifact_metadata: write`, `codespaces_metadata: read`) non déclarées et
  inutilisées. **`/security` les liste désormais telles quelles ; les retirer se
  fait dans les réglages de l'App, à la main.** `ACCOUNT_BACKEND` reste
  `'absent'` : il décrit le site, qui ne lit aucune session, pas le produit.

  `/benchmarks` et `/quality` ne contiennent **aucun chiffre écrit à la main** :
  tout provient de `packages/eval/src/report/benchmarks.json`, généré depuis le
  corpus par `npm run benchmarks:build -w @localize-infra/eval`, et un test
  vérifie que le fichier commité correspond au générateur. Un contrôle sans
  entrée applicable affiche « No data », jamais un pourcentage — le corpus ne
  contient aucun message ICU, et afficher « Pass » pour ces deux contrôles était
  un faux résultat, corrigé. **Ce point disait que le paquet n'était pas
  publié sur npm et que `npx` ne fonctionnait pas. Les trois moitiés sont
  périmées depuis le 2026-08-28** : `@localize-infra/schemas`, `core` et `cli`
  sont publiés en 0.1.0, `npx @localize-infra/cli init` détecte et extrait
  depuis un répertoire vide, et la page d'accueil affiche la commande au lieu
  de s'en excuser. `CLI_PUBLISHED_TO_NPM` porte ce fait à un seul endroit et
  les deux pages le lisent.

  **Jetons CLI personnels (CLI 0.3.0, publié le 2026-09-17).** Le CLI
  ne dépend plus du jeton opérateur partagé. Un jeton `lit_…` est créé par
  chaque membre dans `/[org]/tokens` ; seul son SHA-256 est stocké
  (`cli_tokens`, colonne illisible pour `authenticated`), il expire, se
  révoque seul et meurt quand son auteur quitte le workspace. L'API le résout
  par `resolve_cli_token` (service role seulement) et n'agit **que** par
  l'installation GitHub du workspace — plus de repli sur
  `GITHUB_APP_INSTALLATION_ID` pour ces appelants. `init` vérifie jeton,
  dépôt, branche et droit aux dépôts privés **avant** de dépenser, garde le
  récapitulatif si la PR échoue ensuite, et sort en 1 quand rien n'a été
  traduit ou que la PR a échoué. `API_AUTH_TOKEN` devient strictement
  serveur-à-serveur. `CLI_PERSONAL_TOKENS_LIVE` est à `true` depuis la
  publication, et le site décrit ce chemin.

  **Vérifié en production avant de basculer**, avec un jeton émis par l'app de
  prod et le tarball installé hors du dépôt : `whoami` → `layersky`,
  traduction réelle, PR réelle (fixture #18, fermée), dépôt hors installation
  refusé avant toute traduction, jeton révoqué refusé — codes de sortie 1.
  **L'API refuse tout jeton personnel si `SUPABASE_URL` ou
  `SUPABASE_SERVICE_ROLE_KEY` est vide**, et c'est arrivé : `vercel env add`
  lancé dans un shell non interactif a enregistré des valeurs vides, que
  `vercel env ls` liste comme présentes. Le seul contrôle qui les distingue
  est la réponse de l'API à un `lit_` inconnu — « invalid, expired or
  revoked » quand la résolution marche, « not enabled » quand une variable est
  vide.

  Le tarball, installé dans un projet externe contre une API locale, a trouvé
  deux défauts que les tests unitaires laissaient passer. **Le preflight
  acceptait un dépôt public hors de l'installation** : un jeton d'installation
  lit tout dépôt public, donc `repos.get` répondait 200 et le refus n'arrivait
  qu'à la première écriture, traductions payées. L'appartenance se lit
  désormais dans la liste de l'installation. **Et `/v1/translate` renvoyait
  l'erreur du fournisseur**, qui cite le début et la fin d'une clé OpenAI
  refusée ; elle est journalisée, plus renvoyée. Piège rencontré au passage :
  l'API lancée par `tsx` charge `services/github-app` depuis `dist/`, donc un
  correctif non recompilé semble ne pas marcher.

  **Protection des coûts (2026-09-17).** Un jeton `lit_` valide pouvait
  appeler `/v1/translate` en boucle, et chaque appel atteint un modèle payant
  sur le compte de l'opérateur. Deux garde-fous, tous deux appliqués **avant**
  le travail et **jamais** au jeton opérateur : une fenêtre de débit par jeton
  (30 traductions/min, 10 PR/min) et un plafond journalier par workspace
  (5000 chaînes, 50 PR, remise à zéro à 00:00 UTC). Refus en **429** avec
  `Retry-After` et une phrase qui nomme la limite ; un contrôle d'usage
  impossible répond **503** et n'exécute rien — un contrôle qui échoue ne
  prouve pas qu'il reste du budget.

  Les compteurs vivent en base (`api_usage_daily`, `api_rate_windows`,
  fonction `consume_api_quota` réservée au `service_role`), pas en mémoire :
  l'API est scalée horizontalement, donc un compteur d'instance ne compte que
  lui-même. 46 assertions dans `supabase/tests/api-limits.sql`.

  **Et c'est en service en production, vérifié le 2026-09-18.** Ce paragraphe
  décrivait deux garde-fous sans jamais dire s'ils gardaient quoi que ce soit
  en ligne, et une session entière est repartie de l'hypothèse inverse — « le
  code existe, la production ne l'a pas ». Les deux moitiés étaient fausses :
  `20260917205635_api_usage_limits` est la 37ᵉ des 37 migrations appliquées à
  `localize-infra-prod`, et `/api/version` répond `55b3e2c`, le commit de
  fusion de #100 — un SHA qui n'existe qu'une fois la PR fusionnée, donc le
  déploiement a bien suivi. **Pour un service qui ne suit pas Git, « fusionné »
  ne dit rien de « appliqué » — mais « pas encore déployé » n'est pas plus
  gratuit à supposer.** Deux commandes tranchent, et aucune ne demande de
  réfléchir : la liste des migrations, et `/api/version`.

  **Le garde-fou a été exercé contre la production, et il tient.** 32 appels
  `/v1/translate` avec un jeton `lit_` : les 30 premiers franchissent le quota,
  le 31ᵉ répond **429**, `Retry-After: 40`, « the limit is 30 a minute ».
  Puis une requête annonçant 9000 chaînes — 30 déjà consommées, plafond à
  5000 — répond **429**, `Retry-After: 32512`, soit à la seconde près le temps
  restant jusqu'à 00:00 UTC. Le jeton opérateur, lui, a encaissé 35 appels
  d'affilée sans un seul 429 et **sans écrire une ligne** dans les deux tables :
  il ne traverse pas `checkQuota`, et l'absence de ligne le prouve mieux que
  l'absence de 429.

  **Tout cela sans dépenser un centime, et c'est la partie reproductible.** Le
  quota est débité *avant* la validation du corps, donc un corps invalide
  consomme la fenêtre puis s'arrête en 400 sans atteindre le modèle ; et
  `translationUnits` lit `strings.length` sur le corps brut, donc une requête
  qui *annonce* plus de chaînes qu'il n'en reste au plafond est refusée avant
  tout appel payant. **Tester un garde-fou qui protège de l'argent ne devrait
  pas coûter d'argent** : la question « est-ce que ça refuse ? » se pose ici
  sans jamais déclencher ce qu'on cherche à éviter.

  **Un fait que la migration promettait sans que personne l'ait vu** : après
  les 32 appels, `strings_translated` valait 30 et `request_count` 32. Un refus
  compte dans la fenêtre de débit et **n'est pas facturé** au plafond
  journalier ; le 429 de quota n'a pas entamé le compteur non plus. Le plafond
  a par ailleurs été poussé à sa borne exacte — refus à 5000, **passage à
  4999** — sur la fonction de production, dans une transaction terminée par un
  `raise` délibéré, le motif de `supabase/tests/*.sql` ; les compteurs relus
  après n'avaient pas bougé.

  **Non prouvé en ligne, et il faut le dire** : le chemin **503**. Le
  déclencher exigerait de vider `SUPABASE_URL` ou `SUPABASE_SERVICE_ROLE_KEY`
  sur le projet Vercel, c'est-à-dire de casser la production pour observer
  qu'elle échoue bien. Il reste couvert par les tests unitaires d'`apps/api`,
  pas par une preuve en ligne.

  **Le navigateur dépensait la même chose, et rien ne le comptait.** La
  protection ci-dessus s'arrêtait au jeton CLI, et `apps/api/src/quota.ts`
  justifiait l'exemption ainsi : l'opérateur est « held by `apps/web`, which has
  its own guards ». **`apps/web` n'en avait aucune.** Chaque clic sur « Run
  pipeline » atteignait un modèle payant sans fenêtre de débit ni plafond
  journalier — le navigateur était le moyen le moins cher de dépenser l'argent
  de l'opérateur, et c'était le seul chemin qui écrit une ligne `runs`. Même
  forme qu'`isOperator` et `operatorInstallationId` : une phrase qui décrit un
  contrôle inexistant, et qui fait que personne ne va voir.

  **Corrigé sans second système** (#104, migration `20260918174752`).
  `api_usage_daily` n'a pas changé d'un caractère : elle était déjà clé par
  `(organization_id, usage_date)`, donc la dépense du navigateur atterrit dans
  la même ligne que celle des jetons CLI — ce que « par workspace » voulait déjà
  dire. Seule la fenêtre de débit a été élargie, parce qu'elle était clé par
  jeton et qu'un run de navigateur n'en a pas : son sujet devient **un jeton ou
  un workspace**, tenu par un `check (num_nonnulls(token_id, organization_id) =
  1)` et deux index uniques partiels. `apps/web` appelle `consume_api_quota`
  avec un jeton `null` (`lib/quota/charge.ts`), en `service_role`, fail-closed
  dans toute branche qui n'est pas une autorisation explicite.

  Rien de ce qu'un jeton CLI peut dépenser ne change, et l'exemption de l'API
  reste juste : ce processus authentifie un jeton, pas un workspace, et le
  bearer opérateur ne nomme aucune organisation à débiter.

  **Et il y a eu un troisième cas, de la même forme exactement.** Le webhook
  GitHub a gagné une étape de correction (#132) qui appelle un modèle, avec un
  commentaire expliquant qu'elle n'avait pas besoin de quota. Fermé en #133 en
  résolvant l'organisation depuis `organization_github_installations` — voir
  `apps/web` plus bas. Le motif, trois fois de suite : **une phrase qui décrit un
  contrôle inexistant est ce qui fait que personne ne va voir.**

  **Un refus interrompt le run au lieu d'être isolé.** `QuotaRefusal` est
  relevée par le `catch` par locale ; sans cela un refus honnête en deviendrait
  quatre — un par langue — et le run se dirait `partial`.

  **Ce paragraphe restait vrai et taisait ce qu'il coûtait** (#122, 2026-09-24).
  La relance est correcte — un workspace à court de budget l'est pour toutes les
  langues restantes — mais rien, en amont, ne demandait jamais si le run tenait.
  Un projet de 800 chaînes vers sept locales planifie 5 600 paires contre un
  plafond de 5 000 : six locales débitées et traduites, la septième refusée, le
  run `failed`. **Et un run qui lève n'ouvre aucune PR**, donc le client a payé
  six langues et n'en reçoit aucune. Le plafond ne freinait pas le run, il le
  détruisait, en commençant par la partie la plus chère.

  `lib/quota/preflight.ts` pose la question une fois, avant la boucle. Deux
  refus distincts, parce qu'ils ont deux remèdes : un run plus gros que le
  plafond entier ne passera jamais, et lui dire de revenir à 00:00 UTC serait
  faux. **La borne a été lue dans le SQL, pas devinée** — ligne 200 de
  `20260917000100`, `strings_translated + p_units > strings_per_day`, donc le
  plafond est inclusif et `plannedUnits <= remaining` en est l'équivalent exact :
  le préflight ne peut ni refuser ce que la charge autoriserait, ni admettre ce
  qu'elle tuerait.

  **Il échoue ouvert, à l'inverse de `chargeWorkspace`, et ce n'est pas une
  incohérence** : la charge garde toute l'autorité et échoue fermée, donc un
  préflight muet ne coûte rien que le comportement actuel ne coûte déjà. Un
  garde qui ne sait dire que « ça échouera à coup sûr » a le droit de se taire
  quand il ne sait pas. Il lit en outre comme le **membre** — les deux grants
  existent déjà pour lui — plutôt que d'élargir la surface `service_role`.

  **Le comptage est une seconde passe sur les fichiers de locale, pas un hissage
  de la lecture de la boucle.** `readLocaleFile` lève sur un JSON malformé, et
  dans la boucle c'est une locale qui échoue pendant que les autres continuent ;
  hisser cette lecture aurait silencieusement converti l'isolation par langue en
  abandon du run entier. Un fichier illisible est compté à son pire cas.

  **Le timeout, lui, ne se prédit pas — il se survit.** Un run est une seule
  requête : `handleTranslateBatch` enchaîne ses chunks de 100 chaînes en
  `await`, la boucle des locales aussi, donc la durée est la somme de tout,
  strictement sérielle. Rien ne sait combien de temps prend un chunk, donc il n'y
  a pas de préflight possible. `record_run_translations` n'écrivant qu'après la
  boucle, la coupure jetait tout.

  `translation_cache` (migration `20260924000100`) garde la sortie du modèle par
  `(projet, locale, clé)`, **écrite dans la boucle** dès qu'une locale atterrit.
  Ce placement *est* la fonctionnalité : un run coupé après trois locales sur dix
  en laisse trois achetées, et le clic suivant reprend au lieu de racheter.

  Trois propriétés, chacune testée et mutée : le quota est débité pour
  `toTranslate` et non `pendingStrings`, sinon une reprise refacture ; `translated`
  est **initialisé** avec les clés récupérées et non assigné après, sinon le run
  committe un fichier amputé de ce qu'il a repris pour le garder ; et un hit
  exige que `source_text` corresponde **à l'octet**, une clé dont l'anglais a
  changé étant une autre chaîne.

  **Table dédiée plutôt que `run_translations`** : celle-là est clé par `run_id`,
  alimente l'écran de revue, et son écriture unique est délibérément placée après
  la branche `no_changes`. Y écrire par locale entrerait en collision sur sa clé
  unique et mettrait deux durées de vie dans une table — c'est ainsi qu'on
  supprime la mauvaise.

  **Tous les chemins d'échec y sont muets, par conception.** Un cache illisible
  est un miss : le run fait ce qu'il faisait avant, il traduit et il paie. Aucun
  chemin ne peut produire une mauvaise traduction ; le pire résultat est une
  ligne perdue ou une traduction repayée.

  **Un défaut de cette PR, trouvé par `get_advisors` et pas à la relecture** :
  `anon` pouvait exécuter les deux nouvelles fonctions, alors qu'aucune fonction
  existante du schéma ne l'est. **`revoke all … from public` ne retire pas
  l'attribution par défaut de Supabase au rôle `anon`**, qui est directe et non
  héritée de PUBLIC ; toutes les migrations existantes écrivent `from public,
  anon`. Non exploitable — la garde d'appartenance refuse `anon` de toute façon —
  mais une garde n'est pas une raison de laisser la porte ouverte.

  **Appliquée aux deux bases, et vérifiée par les objets** : table, RLS, 1
  policy, 2 fonctions, **0 grant `anon`**, 2 grants `authenticated`. La prod est
  passée de 38 à 39 migrations, la dev en porte 40 — le correctif du `revoke` y
  est arrivé en deux temps. C'est l'écart légitime que ce fichier décrit plus
  bas : compter des deux côtés ne prouve rien, comparer les objets si.

  **Ce qui n'est prouvé par personne, et il faut le dire** : la reprise n'a
  jamais tourné contre un vrai run. Le code est déployé et le schéma appliqué,
  mais la première preuve sera un run réellement coupé suivi d'un second clic qui
  ne repaie pas. L'e2e ne peut pas l'atteindre, pour la raison donnée plus bas.
  Et **le run meurt toujours au timeout** : il faut re-cliquer. Une reprise sans
  intervention demanderait un worker, qui n'existe pas.

  **L'ordre des instructions de la migration est porteur.** Retirer le `not
  null` avant la clé primaire échoue (`column "token_id" is in a primary key`) :
  la clé l'implique. La base de développement l'a refusée avant CI.

  **Vérifié en production le 2026-09-18**, plafond posé à la main puis restauré
  au caractère près : run `9ea5dff9`, `failed` au stage `translate`, 3 clés
  extraites, **0 traduite**, 0 proposition, **2,6 s** de bout en bout — trop
  rapide pour un modèle. Le compteur n'a pas bougé pendant le refus et une
  fenêtre workspace est passée à 1 : un refus compte dans la fenêtre sans être
  facturé au plafond.

  **Ce que l'e2e ne couvre pas, et pourquoi.** `startRun` sort à « Connect a
  repository before running » bien avant la charge, et aucune organisation semée
  n'a d'installation GitHub — le pipeline ne peut pas atteindre l'appel de
  traduction en CI. La décision est prouvée là où elle est prise, en base.

  **Ce n'est pas de la facturation à l'usage** — l'invariant 3 l'interdit — mais
  `/pricing` promettait « No string cap », ce qui n'était plus vrai : la page
  nomme désormais le plafond, dit qu'il se lève sur demande et qu'auto-héberger
  n'en a aucun. Les nombres existent à deux endroits, `api_limits()` et
  `HOSTED_API_LIMITS`, et les tenir alignés est une étape de release, pas une
  garantie du typage ; un test e2e tient la page à la constante.

  **Ce paragraphe disait qu'installer n'était pas pouvoir s'en servir** : le
  CLI 0.2.0 pointait sur `http://localhost:8787` et l'API n'acceptait que le
  bearer de l'opérateur. C'est périmé depuis la 0.3.0 — voir plus haut. Il
  ajoutait que trois phrases du site affirmaient à tort qu'il n'existait aucune
  API hébergée, dans les branches « publié » du drapeau que personne n'avait vues
  à l'écran ; la leçon reste : **une branche de texte jamais rendue n'a jamais
  été relue**, d'où les tests e2e lancés avec les deux valeurs de
  `CLI_PERSONAL_TOKENS_LIVE`.

  **La landing est rebâtie sur les patterns du template de référence** (#129,
  2026-10-01) — en adaptant son implémentation plutôt qu'en approchant son
  rendu. `components/landing/section.tsx` porte ce qui en vient : `Container`
  est son `px-4 sm:px-6 lg:px-8`, dont le **troisième palier manquait** — entre
  1024 et 1536 la gouttière restait à 24 px pendant que la colonne grandissait ;
  `Section` est son `py-24 sm:py-32`, là où la page tournait à `py-20 sm:py-28` ;
  `FeatureSplit` est le partage deux colonnes de `features-section.tsx`. Les
  eyebrows de section deviennent des `Badge`.

  Ecosystem est la section qui en avait le plus besoin : en-tête pleine largeur
  au-dessus d'une grille 5/7, **638 px de haut pour ~400 px de contenu**, avec
  ~500 px de colonne droite vide — la zone morte que §4.5.2 qualifie de défaut
  et non de blanc. Passée en `FeatureSplit` : **638 → 555 px, même contenu**. La
  bande de clôture a pris la forme centrée du template pour la même raison.

  **L'en-tête centré n'est utilisé qu'une fois, sur Commitments.** §4.4 interdit
  à deux sections adjacentes de partager leur signature ; centrer les sept
  serait exactement le « document, pas une composition » qu'elle nomme. Vérifié
  après chaque changement : les huit tuples *(colonnes, pleine largeur,
  évidence)* restent distincts de leur voisin, et `section-rhythm.spec.ts` le
  prouve.

  **Le favicon existe enfin, et sa première version ne rendait rien.**
  `app/icon.svg` reprend le mark à trois barres du header — mêmes rapports
  100/75/50, valeurs toutes paires pour tomber sur des pixels entiers à 16 px.
  La dégression passe par l'opacité d'une encre et non par les tokens
  `primary`/`strong`/`line` : le troisième, un filet à `#d7dae0`, disparaît à
  16 px sur blanc.

  **Le piège vaut plus que le fichier : un commentaire XML ne peut pas contenir
  de double tiret**, et le mien écrivait `--graphite-12`. Le SVG renvoyait
  **200**, avec `image/svg+xml`, et obtenait sa balise `<link rel="icon">` — il
  rendait un onglet vide. Vérifier que le lien est présent et correctement servi
  ne prouve donc rien du rendu ; ce qui l'a montré est
  `document.querySelector('parsererror')` dans le navigateur.

- `apps/web` (propriétaire) — coquille applicative : barre latérale **256 px**
  (feuille latérale de 288 px sous 768 px, rail de 48 px repliée), barre
  supérieure 48 px, palette de commandes ⌘K, et la galerie `/design` qui rend
  toute la bibliothèque de composants.

  **Ce point disait « 240 px, feuille latérale sous 1024 px ». Les deux
  chiffres étaient faux.** Mesurée dans le navigateur pendant l'audit visuel du
  2026-09-20 : 256 px. La source est `SIDEBAR_WIDTH = '16rem'`
  (`components/ui/sidebar.tsx`) et le basculement est `MOBILE_BREAKPOINT = 768`,
  la barre desktop étant en `md:block`. Ni 240 ni 1024 n'y figurent nulle part —
  ils décrivaient la coquille écrite à la main que shadcn a remplacée, et ils
  ont survécu au remplacement, dans la même phrase, sans que personne les
  relise. C'est l'écart qu'aucun test n'attrape : personne n'écrit d'assertion
  sur une phrase.

  **La palette n'offrait pas l'OLED.** `ThemeToggle` proposait quatre schémas
  depuis la livraison de #110, la palette trois — deux contrôles à quelques
  pixels l'un de l'autre, en désaccord sur le nombre de thèmes du produit, et
  celui qui manquait était le plus récent. Rien ne pouvait le voir : deux
  tableaux littéraux, aucun n'important l'autre, et appeler `setTheme` trois
  fois sur quatre n'est pas une erreur de type. Un test compare désormais les
  deux listes.

  **`/login` déconnectée rendait toute la coquille** — navigation de workspace,
  badge « 3 » sur Review, note de pied sur les données d'exemple — autour du
  formulaire de connexion, pour un visiteur dont chaque lien renvoyait au
  formulaire qu'il regardait. Le layout racine le sait désormais par un
  en-tête `x-pathname` posé par le proxy, lu contre `isPublicPath` — la même
  liste blanche que le proxy applique, exportée plutôt que recopiée.
  **Ce point disait « six de ses sept routes déclarent qu'elles ne sont pas
  construites », et qu'un test e2e vérifiait que chacune le dit. Les deux sont
  périmés.** Il en reste **une**, `/[org]/billing`, et le test qui gardait la
  formule n'existe plus — il a été retiré avec les surfaces qu'il décrivait, au
  fil des PR #19 à #22, sans que ce paragraphe suive.

  **Les grilles se dimensionnent sur leur colonne, plus sur la fenêtre** (#129).
  `@container/main` est posé sur le `<main>` du layout racine — l'endroit exact
  où le template de référence le pose. La raison est mesurable : à une fenêtre
  de **768 px la barre latérale en prend 256**, donc la colonne de contenu fait
  **512 px**, et aucun breakpoint viewport ne peut le voir. `/runs` rendait
  **trois tuiles en travers de 464 px**. Le palier avait déjà été déplacé à la
  main de `lg:` vers `md:` pour contourner le symptôme — contournement remplacé
  par `@md/main` / `@3xl/main`, qui donnent une tuile à 390, **deux à 768**,
  trois à 1440.

  **Un utilitaire qui ne compile pas échoue en silence**, donc la vérification
  porte sur le CSS servi et non sur la source : `@container main
  (min-width:28rem)`, `(min-width:48rem)`, `(min-width:64rem)` et
  `container-type:inline-size` y sont bien.

  **Trois défauts trouvés par mesure, pas à l'œil.** `/review` coiffait ses
  groupes de run en **13 px/500** alors que les lignes qu'il groupe sont en
  `body` 14 — un titre sous son propre contenu, l'échec de §3.5 déjà corrigé
  deux fois sur le site. `/[org]/usage` à 390 poussait sa toolbar **16 px hors
  du panneau** : cause, le `px-4` ajouté avec le panneau lui-même ; `/runs`
  affiche la même toolbar sans panneau et ne déborde pas, ce qui a désigné le
  padding plutôt que la toolbar. Et `/[org]/start` laissait le titre d'étape
  **s'effondrer à 1 px** en portant 68 px de texte — le détail (un chemin de
  dépôt, un seul token insécable) ne pouvait pas rétrécir et le titre avait son
  plancher retiré par `min-w-0` ; les deux sont désormais dans l'autre sens.

  **`packages/ui` *est* du shadcn, et ce point mérite d'être écrit une fois.**
  Le paquet dépend de `radix-ui` et ses primitives interactives sont bâties
  dessus : `Button` sur `Slot`, `Dialog`, `Tabs`/`Avatar`/`Progress`/`Separator`,
  `DropdownMenu`/`Popover`/`Tooltip`, `Select`, `Checkbox`/`RadioGroup`/`Switch`,
  `Toast`. Les primitives « simples » — `Card`, `Table`, `Input`, `Badge`,
  `Alert`, `Breadcrumb` — sont des div + Tailwind, **exactement comme chez
  shadcn**, vérifié dans le template. Mesuré en lignes : ~3 150 d'architecture
  shadcn contre ~980 de spécifique Layersky. Conclusion pratique : il n'y a pas
  de migration à faire, et un composant « à reprendre du template » existe
  presque toujours déjà sous un autre nom.

  Une seule incohérence réelle en est sortie, et elle est corrigée : `Kbd`
  existait, était exporté, et n'était utilisé nulle part pendant que
  `app-topbar.tsx` réécrivait un `<kbd>` à la main. Les deux fichiers citaient
  **la même mesure** — `text-secondary` à 11 px vaut 4,54:1 — et concluaient à
  l'opposé ; la primitive appelait quatre centièmes au-dessus du seuil « une
  coïncidence, pas une marge » et passait à `text-primary`, la copie le
  reconnaissait et gardait `secondary`. Après bascule : **18,17:1 en clair,
  16,58:1 en sombre.**

  `/runs`, `/runs/[id]`, `/locales`, `/ambiguity`, `/review`, `/[org]/projects`,
  `/[org]/projects/[project]`, `/[org]/tokens` et `/[org]/start` lisent Postgres
  sous RLS. Ce qu'ils affichent sans base configurée n'est pas un écran « non
  construit » mais un `NotConnected` qui dit qu'il n'y a pas de base à lire —
  délibérément pas un repli sur des données d'exemple, indiscernable d'un
  produit qui marche.

  La contrainte, elle, ne bouge pas : ne jamais remplacer un écran vide par des
  données inventées.

  **Le parcours self-serve est guidé depuis #102**, sur `/[org]/start` : six
  étapes — workspace, GitHub, dépôt, jeton, run, pull request — dont **une seule
  est ouverte à la fois**, celle qui reste à faire. Un workspace créé y atterrit
  au lieu de `/[org]/projects`, parce qu'une liste vide et un panneau de
  connexion n'énoncent aucun ordre entre eux, et que l'ordre n'est pas
  devinable : un jeton ne sert à rien avant GitHub, et `--open-pr` est refusé
  avant un dépôt.

  **Rien n'est mémorisé.** Pas de table d'onboarding, pas de colonne
  `completed_steps` : chaque état se dérive des lignes que le produit écrit
  déjà. Un état stocké serait un second récit des mêmes faits, libre de les
  contredire, et son premier symptôme serait de réclamer un dépôt connecté une
  heure plus tôt. C'est la raison qui vaut déjà pour `lib/metrics/funnel.ts` ;
  les deux modules lisent les mêmes lignes et répondent à deux questions
  distinctes — « combien » et « quoi maintenant ».

  **Trois défauts trouvés en le construisant, chacun cassant le parcours qu'il
  servait.** Le panneau de jeton donnait `export LOCALIZE_API_TOKEN=…` puis
  `npx @localize-infra/cli init`. **`export` est une erreur de syntaxe sous
  PowerShell**, le shell par défaut de Windows, et `init` sans `--open-pr`
  traduit sans rien ouvrir : l'écran dont c'est tout l'objet distribuait la
  seule commande qui ne peut pas produire de pull request, contre l'invariant 2.
  Les deux dialectes sont proposés, et un test épingle les drapeaux à ceux que
  `packages/cli` parse vraiment.

  **« Connecté » n'était qu'une ligne en base.** Un propriétaire peut
  désinstaller l'App côté GitHub sans que rien ici ne l'apprenne ; on le
  découvrait par un run qui échoue *après* avoir payé toutes les locales. Un
  bouton **Verify** interroge GitHub à la demande, pas au rendu : la réponse
  change rarement, la page se recharge souvent, et un contrôle que personne n'a
  demandé et qui échoue en silence est pire que pas de contrôle. Troisième
  défaut, `lib/cli-config.ts` affirmait encore « API token — Not set » et un
  jeton opérateur obligatoire — périmé depuis la 0.3.0, sur la seule surface qui
  prétend rapporter la configuration réelle.

  **Le piège à retenir, parce qu'il passe le build :** un fichier `'use server'`
  n'exporte **que des fonctions asynchrones**. La constante d'état initial vivait
  à côté de l'action ; `next build` et `tsc` passaient tous les deux, et Next
  refusait le module à l'exécution — `A "use server" file can only export async
  functions, found object`. Le symptôme était un bouton qui ne faisait rien.
  Exporter un *type* reste acceptable, les types étant effacés ; une constante
  non.

  **La couleur suit §6.3 sans exception** : une étape non atteinte n'a aucun
  état, donc aucune teinte — l'ambre affirmerait un comportement dégradé.
  L'Iris n'apparaît que pour un run arrêté sur une question, le seul sens que
  §1.4 lui réserve, et un test parcourt tous les statuts de run pour prouver
  qu'il n'apparaît nulle part ailleurs.

  **Le test e2e du nouvel utilisateur a appris deux choses sur l'inscription.**
  Elle refuse `@localize-infra.dev` : ce domaine n'a jamais été enregistré, donc
  il n'a pas de MX, et le seed ne fonctionne que parce qu'il insère en SQL en
  contournant l'API d'auth — le spec utilise `example.com`, réservé par la
  RFC 2606. Et il a d'abord échoué en CI en cliquant « Sign in » juste après
  l'envoi d'inscription : **deux choses couraient dans la même page**, le cookie
  que l'action venait de poser — qui fait re-rendre Next — et un second envoi du
  même formulaire. Demander à `/` où en est le visiteur tranche sans ambiguïté.
  La règle qui en sort : **ne pas enchaîner deux soumissions sur un formulaire
  dont la première a modifié la session.**

  **Non vérifiable sur la machine du propriétaire, et vérifié en CI** : la jambe
  inscription. Le projet Supabase de dev a la confirmation e-mail active et sa
  limite de deux envois par heure, donc l'inscription y répond « email rate
  limit exceeded » ; la pile locale que lance le job `e2e` a
  `enable_confirmations = false` et n'en a aucune. Les huit tests y tournent.

  **`/[org]/usage` montre à un membre ce que son workspace a dépensé** (#105) :
  aujourd'hui contre le plafond, le total du mois, les derniers runs et la
  dernière utilisation de chaque jeton CLI. **Aucun backend nouveau** — ni
  table, ni migration, ni RPC, ni clé `service_role`. Tout était déjà lisible
  par un membre : `api_usage_daily` par `api_usage_select_member`,
  `api_limits()` par son grant à `authenticated`, `cli_tokens` par un grant de
  colonnes qui exclut `token_hash`, `runs` sous la RLS habituelle. L'isolation
  est donc celle de la base — un autre workspace est un 404 parce que les
  policies ne rendent rien, pas parce que la page le décide.

  **Elle lit, elle ne recompte jamais.** Chaque chiffre vient d'`api_usage_daily`,
  la ligne que `consume_api_quota` écrit en débitant ; rien n'est redérivé de
  `runs` ni de `run_translations`, parce qu'un second décompte serait libre de
  contredire celui contre lequel le plafond est appliqué — et la page promettrait
  alors du budget que l'API refuse.

  **Elle montre désormais aussi ce que les corrections de PR ont dépensé**, sans
  une ligne de changement : depuis #133 le webhook débite la même table. La page
  n'a donc pas de rubrique « runs » et « corrections » séparées, et c'est
  cohérent avec ce que le plafond veut dire — un workspace, un plafond, quel que
  soit le chemin. Ce qu'elle n'attribue pas, en revanche, c'est **quel** chemin a
  dépensé : `api_usage_daily` ne porte pas cette colonne. Les derniers runs
  qu'elle liste viennent de `runs`, donc une dépense de correction apparaît dans
  le total du jour sans run correspondant.

  **Zéro y est affiché, et ce n'est pas la règle du funnel qui casse.**
  `lib/metrics/funnel.ts` refuse d'écrire zéro pour ce que personne ne mesure, et
  il a raison. Ici c'est le cas inverse : `consume_api_quota` crée la ligne à la
  première dépense du jour, donc **pas de ligne veut dire pas de dépense** — un
  fait, pas une mesure absente. Et la couleur suit §6.3 : être sous le plafond
  n'est pas un état, donc pas de jauge ni de barre virant au rouge ; seul
  *atteindre* le plafond prend une teinte, parce qu'alors le refus est réel.

  **Elle a exigé d'amender le PRD.** §18 disait « we never meter … **Not even as
  a displayed statistic** ». L'invariant 3 est intact — aucun chiffre n'entre
  dans une facture — mais la ligne passe de *l'affichage* à *la facturation*,
  parce que le produit a gagné un plafond d'abus que le PRD n'anticipait pas.
  Trois conditions rendent l'exception sûre et sont écrites dans le document :
  plan forfaitaire, plafond levé gratuitement sur demande, aucun plafond en
  auto-hébergement. **Si l'une tombe, la clause revient.** Les autres
  interdictions n'ont pas bougé — `01-prd.md:220`, `07-milestones.md:198/200/270`
  et `02-ux-and-flows.md:217` parlent de la page de facturation, que
  `/[org]/usage` n'est pas.

  **Le classifieur a refusé que l'agent modifie le PRD**, comme auto-modification,
  et c'était le bon réflexe : réécrire soi-même la règle qui interdit ce qu'on
  vient de construire est précisément ce que ce garde-fou protège. Le texte a été
  proposé, validé par le propriétaire, puis appliqué.

  **Jamais ouverte par un œil humain au moment de la fusion**, et il faut le
  dire : la preview d'`apps/web` est derrière le SSO Vercel et la production
  exige une session. Son comportement est prouvé par 8 tests e2e en CI ; sa mise
  en page ne l'est par personne.

  **`no_changes` n'a jamais rien cassé. Les clics partaient sur le mauvais
  projet.** Ce paragraphe l'a affirmé coupable deux fois — d'abord « établi par
  expérience », puis « un blocage côté client, cause inconnue ». Les deux
  étaient faux, et les deux ont été écrits avec l'assurance d'un fait.

  L'organisation `layersky` porte **deux** projets, tous deux branchés sur le
  dépôt fixture :

  | Projet | `target_locales` | Runs créés |
  |---|---|---|
  | `localize-infra-test` — « Localize Infra Test » | **vide** | **0, jamais** — supprimé depuis, voir plus bas |
  | `localize-infra-test-2` — « localize-infra test #2 » | `fr, de, ja, es` | les 7, sans exception |

  `startRun` refuse un projet sans langue cible **avant** `start_run`, donc sans
  écrire de ligne :

      if (project.target_locales.length === 0) return { error: '…' };

  Chaque « rien ne se passe » du 2026-08-31 est un clic sur le projet vide.
  Chaque « ça marche » est un clic sur `#2`. La variable qui changeait n'était
  pas le code déployé, c'était le projet ouvert dans l'onglet.

  **Coût de l'erreur** : deux reverts, une relivraison, cinq déploiements de
  production, et deux affirmations fausses inscrites ici. La cause tenait dans
  une requête que rien n'empêchait de faire dès le premier échec — joindre
  `runs` à `projects` pour voir sur quel projet les runs réussis atterrissaient.
  Toutes les vérifications faites à la place — logs Vercel, santé de l'App
  GitHub, nonces CSP, chunks servis, `dist` compilé, cache turbo — portaient sur
  une chaîne qui n'a jamais été en cause.

  **La règle qui en sort, et qui vaut au-delà de ce bug** : quand deux
  configurations donnent des résultats opposés, vérifier d'abord que l'entrée
  est la même. Ici les runs portaient leur `project_id` depuis le début.

  **Le piège d'affichage, lui, est réel et reste à traiter.** La liste des runs
  se rafraîchit après un clic et montre l'entrée la plus récente. Un clic sans
  effet laisse donc le run **précédent** en tête, avec son badge et son lien de
  pull request — indiscernable d'un résultat neuf. Cinq lectures d'écran ont été
  rapportées comme des succès et démenties par la base. **Ne jamais conclure
  qu'un run a eu lieu depuis l'écran : lire la ligne en base et le numéro de
  PR.**

  **`localize-infra-test` a été supprimé le 2026-09-05, et l'organisation n'a
  plus qu'un projet.** Il portait 0 run et 0 proposition — créé le 2026-08-29 à
  00:12, cinq minutes avant `localize-infra test #2`, sur **le même dépôt**, et
  jamais utilisé. Toute l'activité, 8 runs et 72 propositions, est sur l'autre.

  Deux projets pointant sur un seul dépôt étaient l'ambiguïté elle-même. Lui
  donner des langues cibles l'aurait rendu utilisable sans la lever : deux
  projets actifs sur `localize-infra-fixture-vite` produiraient des pull
  requests concurrentes, et un clic sur le mauvais coûterait cette fois un run
  réel plutôt qu'un refus silencieux.

  La suppression a demandé un `DELETE` SQL direct, faute de chemin produit. La
  requête portait son propre garde — `and not exists (select 1 from runs where
  project_id = ...)` — pour qu'une erreur de slug ne puisse pas emporter une
  ligne qui compte. Vérifié après : totaux inchangés, 8 runs, 72 propositions,
  1 organisation, 1 installation.

  **Ce point ajoutait que `deleteProject` n'a aucun appelant et que le produit
  ne sait donc pas supprimer un projet. Les deux moitiés sont périmées depuis
  #81** : `/[org]/projects/[project]` porte la surface, réservée aux `owner` et
  `admin` parce que c'est ce qu'admet `projects_delete_admin`. Elle affiche ce
  que la suppression emporte — `runs`, `run_translations` et `run_ambiguities`
  cascadent — compté en base plutôt que décrit, « cette action est irréversible »
  étant vrai de tout bouton de suppression et n'apprenant rien sur ses propres
  données.

  **Trois contrôles vivent dans l'action, pas dans le formulaire**, parce qu'une
  server action est un endpoint public : le nom tapé, comparé au slug **relu
  depuis la ligne visée** et non à celui envoyé dans la même requête ; le type
  de ce champ, `FormData.get` rendant un `File` dont `.trim` n'existe pas ; et
  le **nombre de lignes supprimées**. Ce dernier n'est pas décoratif : la
  lecture passe sous la policy `select`, qui admet tout membre, la suppression
  sous `projects_delete_admin`. Sans ce compte, un membre franchit la
  confirmation, ne supprime rien, ne reçoit aucune erreur et est redirigé comme
  si ça avait marché. Les deux premiers corrigent des défauts de la première
  version de #81, trouvés en relisant le diff avant de le commiter.

  Le test e2e crée son propre projet au lieu de viser une ligne du seed — une
  suite qui supprime un fixture partagé passe une fois et échoue à la deuxième
  exécution — et il a été vérifié non vacant en desserrant `confirmsDeletion` en
  insensible à la casse : il rougit, puis repasse au vert une fois restauré.
  **Non couvert, et il faut le dire** : le chemin « membre non-admin » n'a pas
  de test, faute de compte membre dans le seed. Le garde-fou est lisible dans
  l'action ; il n'est prouvé par rien.

  Ce qui reste vrai et vaut au-delà de ce cas : **un projet sans langue cible
  affiche désormais la raison au lieu d'un bouton inopérant** (#67), donc la
  configuration n'est plus un piège — elle est seulement inutile.

  **Deux acquis de l'épisode, indépendants de la fausse piste.** La section
  entre le clic et `start_run` vivait hors du `try` : une exception y était
  perdue, sans ligne et sans message. Elle est enveloppée depuis #64 et renvoie
  l'exception verbatim à l'écran ; `isNextControlFlowError`
  (`lib/runs/control-flow.ts`) relaie intact ce que Next lève pour naviguer, en
  testant la **valeur** du digest et non sa présence. Et la revue finale de #60
  a trouvé un vrai défaut : `/runs/[id]` portait une troisième table de statut,
  en `Record<string, …>` avec un repli sur `failed`, qui affichait « Failed »
  et un décompte de traductions manquantes fabriqué. Corrigé, et la table est
  désormais indexée par l'union.

  **Le décompte des PR vides sur le fixture était faux, et il avait été recopié
  quatre fois.** Quatre fichiers affirmaient « deux PR vides, #1 et #2, ouvertes
  depuis août » — un commentaire de `run-actions.ts`, une migration, le plan, et
  ce fichier. Personne ne les avait ouvertes. **#1 contient `locales/es.json`,
  #2 contient `locales/en.json` et `locales/fr.json`** : de vraies traductions,
  issues de la validation de M1 en août.

  Les PR réellement vides étaient **#10 à #14**, cinq en deux jours, toutes
  produites par le défaut que `no_changes` corrige, toutes fermées le
  2026-09-02. C'est d'ailleurs un meilleur argument que celui qui était avancé :
  cinq en deux jours, pas deux en trois semaines.

  Le mécanisme est celui que ce fichier documente à répétition — une affirmation
  écrite une fois, puis recopiée de fichier en fichier sans que personne
  retourne à la source. Elle a fini dans du code livré. `gh pr view N
  --json changedFiles` la démentait en une commande.

  **Le refus est désormais aussi dans l'API, et c'est elle qui a le dernier
  mot.** `services/github-app/src/open-pr.ts` compare le SHA de l'arbre produit
  par `createTree` à celui de la base : identiques, il n'y a rien à livrer.
  `/v1/open-pr` répond alors **409** — vérifié contre le vrai GitHub le
  2026-09-04, sans PR ni branche orpheline créée, voir `apps/api/DEPLOYING.md` —
  et `packages/cli` traite ce code comme un
  résultat — « No PR opened: every translation is already on the base branch. »
  — au lieu de lever.

  Ce contrôle vit là et pas chez l'appelant parce que **seule cette couche sait
  ce que contient la base**. `apps/web` matérialise une copie de la branche et
  peut comparer le contenu lui-même, ce qu'il fait ; `packages/cli` travaille
  sur un répertoire local qui peut déjà différer du distant, si bien que sa
  propre comparaison répondrait à une autre question.

  **409 plutôt qu'un corps 200 élargi, à cause de npm.**
  `@localize-infra/cli@0.1.0` est publié et parse la réponse 200 avec un schéma
  qui exige `prUrl`. Un corps sans lui ferait planter ce client sur une
  `ZodError` illisible ; un non-2xx, il le gère déjà et l'affiche en clair.

  **Et `apps/api` ne suit pas Git.** Fusionner ne déploie pas ce correctif :
  il faut `npx vercel deploy --prod --archive=tgz` depuis `apps/api`. Tant que
  ce n'est pas fait, l'API en ligne continue d'ouvrir des PR vides — c'est
  exactement le piège que ce fichier décrit plus bas, et il s'applique ici.

  **Les trois migrations sont appliquées aux deux bases.** `run_status` porte
  `no_changes`, `finish_run` et `advance_run` le traitent comme terminal.

  CSP à nonce par requête (`src/proxy.ts`), à l'inverse d'`apps/site` : les deux
  configurations documentent leur arbitrage et pourquoi il ne se transpose pas.

  ### Le guardrail i18n sur pull request — premier vertical slice

  **Le produit a une seconde hypothèse, et elle tourne** (#124 et #125,
  2026-09-29). L'ancien pipeline `extraction → traduction → PR` reste, en
  legacy. Le nouveau est `PR GitHub → analyse i18n → GitHub Check`, et la
  valeur visée n'est plus de traduire mais de **détecter ce qu'une PR casse**.

  `POST /api/github/webhook` (`apps/web`) reçoit, `packages/core/src/i18n`
  lit — bibliothèque i18n, clés appelées, catalogues — et
  `packages/eval/src/audit` juge, en réutilisant `extractPlaceholders`,
  `isIcuMessage` et `validateIcu`, déjà sous gate CI à 99,5 %.

  **Cette phrase disait « Aucun modèle n'est appelé sur ce chemin : pas de coût,
  pas de quota, pas de file ». Elle est fausse depuis #132.** L'analyse, elle,
  n'appelle toujours aucun modèle — mais la correction qui la suit en appelle un,
  et le quota existe depuis #133. Voir « La boucle se ferme » plus bas.

  **Prouvé contre un vrai dépôt, pas seulement en test.** PR #13 de
  `localize-infra-fixture-i18next` ajoute `app.continuousTest` à
  `locales/en/common.json` et oublie six langues. Le 2026-09-29 à 13:16 UTC, le
  Check `Layersky i18n` sur `d73683d` a répondu `neutral`, *« 6 i18n
  problems — Checked 1 key against 6 languages »*, une ligne par locale.

  **« Checked 1 key », pas 12, et c'est la propriété qui rend l'outil
  utilisable.** Le catalogue anglais porte d'autres clés non traduites ; une PR
  ne répond que de celles qu'elle **ajoute**, calculées contre `base.sha`.
  Reprocher l'arriéré est la façon la plus sûre de faire désactiver un check.

  **La première version était aveugle au cas le plus fréquent.** Elle ne
  scannait que les fichiers source modifiés, donc une PR qui ne touche qu'un
  catalogue produisait *« No translation keys were touched »* — exact sur ce
  qu'elle avait regardé, inutile sur ce qui comptait. La conception partait de
  « le code appelle une clé » ; le cas réel est l'inverse, le catalogue gagne
  une clé et personne ne traduit. C'est #125 qui l'a corrigé.

  **Trois choses n'ont demandé aucune infrastructure.** L'idempotence : GitHub
  clé ses check runs par `(name, head_sha)`, donc une seconde livraison met à
  jour au lieu d'empiler — pas de table. La prévention de boucle : deux signaux
  gratuits et indépendants, le préfixe de branche que ce produit utilise et
  l'auteur `Bot`. Et pas de file, parce que l'analyse est du calcul sur les
  fichiers d'une PR — **ce qui cesserait d'être vrai si une étape de correction
  était ajoutée**, le run redevenant une somme d'appels modèle.

  **Cette étape a été ajoutée, et la prédiction était à moitié juste.** Il n'y a
  toujours pas de file : la borne est `MAX_CORRECTION_UNITS`, posée avant que
  quoi que ce soit ne démarre. Mais les deux premières moitiés ont tenu
  (idempotence et prévention de boucle, inchangées), et c'est le **délai de
  livraison de GitHub** qui a cassé, pas le budget. Voir plus bas.

  **`neutral`, jamais `failure`.** Personne n'a accepté que ça bloque une
  fusion, et rougir sur un dépôt à checks obligatoires arrêterait le travail de
  quelqu'un sur la foi d'une hypothèse qu'aucun utilisateur n'a validée. Ça
  peut devenir `failure` le jour où on le demande ; c'est le sens qui n'exige
  pas d'excuses.

  **Un dépôt non analysable reçoit un Check qui le dit, et `neutral`.** « No
  problems found » sur un dépôt dont rien n'a été lu est un silence qui se lit
  comme une approbation — précisément le défaut que ce produit prétend
  supprimer.

  #### La boucle se ferme : le Check corrige ce qu'il trouve

  **Le cycle complet tourne** (#132 le 2026-09-29, puis #133 à #136 le
  2026-10-02) : `PR GitHub → analyse → Check → quota → traduction → PR
  corrective → fusion → synchronize → Check`. Un seul cas supporté, et c'est
  délibéré : une clé ajoutée dans la locale source et absente d'une ou plusieurs
  locales cibles. Tout le reste est laissé visible et non touché.

  L'ordre *est* la propriété de sûreté : **plan → charge → traduction →
  ré-audit → écriture**. Le ré-audit n'est pas une formalité — les catalogues
  corrigés repassent par le même `auditI18n` qui a produit les findings, et une
  traduction n'est écrite que si cette fonction ne dit plus rien d'elle. Un
  modèle qui laisse tomber `{{name}}` est arrêté là, avant le commit, par le code
  qui l'aurait sinon attrapé un Check plus tard.

  Ce qui est refusé plutôt que deviné : `placeholder-mismatch`, `icu-invalid` et
  `missing-source` ne sont jamais corrigés — lequel des deux côtés a tort est un
  jugement, et écraser une traduction humaine pour verdir un Check est l'inverse
  de ce que le Check sert. `insertKeys` refuse au lieu d'écraser, y compris le
  cas où `a.b` transformerait la traduction `a` en groupe. Et une traduction
  `ambiguous` n'est pas commitée : invariant 4.

  ##### Le quota : `installation_id → workspace → chargeWorkspace` (#133, `14c4aa1`)

  La correction atteignait un modèle payant sans que rien ne le compte.
  `chargeWorkspace` exige une organisation ; un webhook authentifie une
  **installation**. La seule borne était `MAX_CORRECTION_UNITS` — 40 paires par
  livraison, et rien du tout par jour.

  Même forme que le défaut que `apps/api/src/quota.ts` décrivait et que ce même
  dépôt a reproduit : une phrase qui explique pourquoi un garde-fou est inutile,
  posée là où le garde-fou devrait être.

  **Aucune migration, aucune fonction, aucun compteur neuf.**
  `organization_github_installations` porte la correspondance depuis
  `20260817000600` et son `installation_id` est `unique`, donc une livraison
  résout vers au plus un workspace. Personne ne posait la question à cette table.
  `consume_api_quota` et `api_usage_daily` sont ceux du navigateur et du CLI — le
  plafond était déjà clé par workspace.

  La lecture passe par la clé `service_role` parce qu'**il n'y a pas de session à
  utiliser** : la seule policy de la table veut un membre authentifié, et à
  l'autre bout de la requête il y a GitHub.

  Trois refus, tous fail-closed, trois phrases distinctes — non connecté /
  `SUPABASE_SERVICE_ROLE_KEY` absente, nommée / lecture échouée. La première se
  règle dans le dashboard en une minute, les deux autres sont des problèmes
  d'opérateur, et c'est ce qui les sépare.

  **Une seule charge atomique pour tout le plan, jamais par locale.**
  `run-actions.ts` débite par locale parce qu'une reprise garde ce qu'elle a
  acheté ; ici il n'y a pas de reprise — une correction est une PR ou rien —
  donc un refus sur la quatrième de six locales jetterait trois locales déjà
  payées. C'est la panne pour laquelle `lib/quota/preflight.ts` existe.

  **`open_pr` avant `translate`**, pour ne jamais acheter la moitié chère d'une
  correction que le plafond ne laissera pas livrer. Et pas plus tôt : une
  livraison qui ne planifie rien est le cas courant, puisqu'un
  `placeholder-mismatch` est toujours laissé à une personne.

  ##### Le premier vrai cycle, et ce qu'il a trouvé (2026-10-02)

  PR #15 du fixture ajoute **une** clé anglaise, `errors.timeout`, et rien
  d'autre. Six findings, Check `neutral` en moins de 10 s, PR corrective #16 en
  moins de 30 s, cinq locales écrites, fusionnée, `synchronize`, et le Check
  passe de **6 problèmes à 1**. Aucune traduction existante touchée, aucun
  fichier source modifié, `main` du fixture intact.

  Base de référence prise **avant** : aucune ligne `api_usage_daily` pour la
  journée, aucune fenêtre `api_rate_windows` clé par workspace. L'apparition des
  lignes est donc la preuve, pas un delta interprété. Après : deux lignes de
  fenêtre avec `organization_id` et `token_id` **null** — la forme exacte
  qu'impose `check (num_nonnulls(token_id, organization_id) = 1)` — et aucune
  ligne clé par jeton. Rien n'a été dépensé hors quota.

  Deux faits que seul le réel pouvait donner :

  - **6 débités, 5 livrés.** « On facture ce qui est *envoyé*, pas ce qui survit
    au ré-audit » — écrit d'abord, observé ensuite.
  - **`prs_opened` monte sans qu'une PR s'ouvre.** C'est le coût assumé de
    l'ordre `open_pr` avant `translate`, constaté deux fois.

  **Et l'allemand a disparu sans laisser de trace.** Ni dans le corps de la PR,
  ni dans la réponse du webhook, ni dans un log. Le titre disait « add 5 missing
  translations » alors que six avaient été demandées : le seul nombre visible
  sans rien ouvrir était celui qui cachait le trou.

  ##### Rien ne peut plus disparaître en silence (#134, `a0aa8f1`)

  Trois chemins muets, tous de la même famille :

  - `translateBatch` jetait `missingKeys` et `failures` de la réponse et
    transmettait `confidence` **sans** le `question` qui l'accompagne. La réponse
    portait la raison et l'appelant la jetait ;
  - la boucle des candidats abandonnait une traduction non-confident ou absente
    par un `continue` nu ;
  - la boucle d'écriture le faisait **deux fois de plus** — un catalogue
    illisible, et une clé que `insertKeys` refuse. Celui-là n'a jamais été
    observé : il a été trouvé en cherchant les frères du premier.

  Désormais `requested === applied.length + rejected.length`, **toujours**, et
  c'est structurel et non une discipline : chaque chemin explique ses propres
  refus, et une passe de réconciliation étiquette tout reliquat comme « un défaut
  de l'outil, pas un jugement sur la traduction », dans ces termes. Le prochain
  trou se signale à sa première occurrence au lieu d'attendre qu'on remarque une
  langue manquante.

  `describeTranslationRefusal` donne à chaque cause sa phrase, parce que chacune
  a son remède : un échec de chunk se retente, un retour non-confident porte la
  question du modèle et demande une personne, `missingKeys` est la route qui
  déclare une omission, et la dernière branche accuse ce code.

  Un échec de requête sur une locale n'emporte plus les autres : il devient
  l'entrée de cette locale, et une correction partielle atterrit quand même.

  ##### Le délai de GitHub est de dix secondes, et il a fallu deux PR pour le voir

  **C'est le fait le plus coûteux de la journée.** Le timeout de Vercel est de
  300 s ; **celui de la livraison GitHub est de 10 s**. Toute livraison qui
  travaillait était enregistrée en **500 `context deadline exceeded`** ; la seule
  qui répondait 200 était celle que le webhook déclinait instantanément par le
  préfixe de branche. Six d'affilée.

  Conséquence qui a invalidé un correctif tout juste livré : **la réponse HTTP du
  webhook n'est pas une surface de compte rendu.** #134 venait d'y mettre la liste
  des refus — morte à l'arrivée. Et le cas qui n'a aucune autre surface l'a
  prouvé : quand *tout* est refusé il n'y a pas de PR corrective, donc la raison
  n'existait nulle part qu'un humain puisse atteindre.

  **#135 (`9b71cf1`) a visé la mauvaise moitié.** Il a déplacé la correction dans
  `after` et porté son compte rendu sur le Check — ça, ça marche et c'est
  vérifié. Mais son titre annonçait « answer GitHub in time », et **c'était
  faux** : remesurée, la livraison mourait toujours à **10,003 s**, la limite à
  la milliseconde, parce que l'analyse la dépasse à elle seule —
  `materialiseRepository` télécharge et décompresse un tarball de dépôt avant que
  quoi que ce soit ne soit lu. Le débit du quota est passé de 9,2 s à 11,5 s,
  c'est-à-dire de *juste* trop tard à franchement trop tard.

  **#136 (`9502c16`) coupe là où le réseau commence.** Avant la réponse : une
  lecture d'environnement, un HMAC, un `JSON.parse`, `decideWebhook`. Après, dans
  `handleDelivery` : le jeton d'installation, la liste des fichiers, le tarball,
  l'analyse, le Check, la correction, le nettoyage. Vérifié contre une vraie
  livraison :

  | | |
  |---|---|
  | push | +0,0 s |
  | `pull_request.synchronize` → **OK 200** | +3,3 s |
  | quota débité, en arrière-plan | +11,7 s |

  Toujours pas de file, et il ne faut pas s'y tromper : le travail se fait dans
  la même invocation, borné par `MAX_CORRECTION_UNITS` avant de démarrer, et
  perdu si la fonction meurt.

  **Ce que ça coûte.** Rien après la réponse ne peut se rapporter en retournant.
  Deux choses remplacent ça : chaque échec est journalisé avec
  `owner/repo#N (sha)`, et chaque échec qui atteint encore GitHub s'écrit sur le
  Check en « Not analysed », `neutral`, erreur verbatim tronquée. Un échec qui
  n'atteint pas GitHub ne laisse que le log — c'est écrit tel quel, pas
  sous-entendu.

  **Un défaut trouvé en écrivant ce remplacement, pas après.** Un échec survenant
  *après* la publication des findings écraserait « 6 i18n problems » par « Not
  analysed » et détruirait la seule chose que le relecteur avait.
  `publishAnalysisFailure` refuse par `alreadyPublished` : un rapport plus tardif
  et plus pauvre ne gagne pas, et le log le garde.

  ##### L'allemand, et pourquoi il fallait le rendre lisible

  Trois refus silencieux d'affilée, puis la question est apparue sur le Check :

  > *the model was not confident and asked: Should the message use formal 'Sie'
  > or informal 'du' address, consistent with the rest of the app's voice?*

  Elle est **bonne** — le registre allemand ne se déduit pas d'une chaîne isolée.
  Le produit faisait exactement ce que l'invariant 4 demande, et personne ne
  pouvait le voir. La leçon qui dépasse ce cas : **un refus que personne ne peut
  lire est indiscernable d'un bug**, et il a d'ailleurs été pris pour un bug
  pendant trois livraisons.

  PR #15 reste ouverte à `1 i18n problem`. La fermer demande une décision humaine
  sur le registre, pas une traduction de plus.

  ##### Outillage et pièges, pour ne pas les redécouvrir

  **`GET /app/hook/deliveries` exige un JWT d'App**, pas le jeton utilisateur :
  `gh api` échoue en 401. Un script de 40 lignes qui signe un RS256 avec la clé
  de `GITHUB_APP_PRIVATE_KEY_PATH` suffit. C'est la **seule** source qui dit si
  GitHub a essayé et avec quel code — aucun log applicatif ne peut le dire, et
  c'est elle qui a révélé les six 500.

  **Les identifiants de livraison ont 19 chiffres.** `res.json()` les passe par
  un `Number` et perd la précision, donc la requête par identifiant répond 404.
  C'est un défaut de la sonde, pas du produit — la colonne de statut de la liste
  reste exploitable, et c'est pour ça que le corps de la réponse n'a jamais été
  lu directement.

  **`=== null` et non `!` sur une union discriminée.** `resolveInstallationWorkspace`
  rend `{ organizationId: string; reason: null } | { organizationId: null; reason:
  string }` ; `!workspace.organizationId` ne peut pas exclure la chaîne vide, donc
  `reason` restait `string | null` et le refus perdait sa phrase. C'est le
  compilateur qui l'a dit, pas la relecture.

  **`after` vient de `next/server`** (Next 16.3.1) et n'a demandé aucune
  dépendance. Vérifié à l'exécution avant d'être employé : sur cette version il
  est bien exporté.

  #### Le piège qui a coûté la journée : App ≠ installation

  Le webhook n'a rien reçu pendant des heures, et la cause n'était dans aucun
  log : **modifier les permissions ou les événements d'une GitHub App est une
  *demande*. L'installation existante garde l'ancien jeu tant que le
  propriétaire n'a pas accepté.** `GET /app` annonçait
  `events: ["pull_request"]` et `checks: write` ; `GET /app/installations/<id>`
  répondait `events: []` et pas de `checks`.

  **Le témoin est `updated_at` sur l'installation.** Il est resté figé à la
  seconde près pendant trois tentatives, dont un double Save qui a bien
  re-déclaré le côté App. Aucun bandeau d'acceptation n'est jamais apparu. La
  seule issue a été **désinstaller et réinstaller**, ce qui accorde le jeu
  courant d'emblée — et crée un **nouvel `installation_id`**.

  Coût de ce changement : `organization_github_installations` porte cet
  identifiant, **une ligne, un seul endroit** — `GITHUB_APP_INSTALLATION_ID`
  n'existe plus sur aucun projet Vercel. L'installation est passée de
  `151289538` (supprimée, 404) à `166148995`, et la ligne a été mise à jour le
  2026-09-29. Le webhook n'en dépend pas, il lit l'identifiant dans la
  livraison ; **« Run pipeline » depuis le navigateur, si** — il le résout
  depuis cette ligne, et il a été cassé entre la réinstallation et la mise à
  jour.

  **Cette phrase est périmée depuis #133 et c'est important.** Le webhook lit
  toujours l'identifiant dans la livraison pour *agir*, mais il lit désormais
  cette ligne pour savoir **qui paie** — et il échoue fermé si elle n'y est pas :
  aucune traduction, un Check qui le dit. Donc une ligne fausse ou absente ne
  casse plus seulement le bouton du navigateur, elle désarme la correction
  automatique. Vérifié avant de livrer #133 plutôt que supposé : `166148995`
  résout bien vers `layersky` en production.

  La règle : **écrire l'`UPDATE` ne prouve pas qu'il marche.** Ce qui le prouve
  est d'émettre un jeton d'installation pour l'identifiant désormais stocké et
  de lister les dépôts qu'il atteint.

  Et la leçon de diagnostic, plus générale : `hook_attributes` **n'est pas
  renvoyé** par `GET /app`, donc en conclure « aucune URL de webhook » est
  faux — c'est l'absence du champ, pas du réglage. `GET /app/hook/config` le
  donne. `GET /app/hook/deliveries` dit si GitHub a seulement essayé, ce
  qu'aucun log applicatif ne peut dire.

  #### Limites connues de ce slice

  **Un seul framework : i18next.** next-intl et react-intl sont détectés et
  déclarés non supportés — une réponse différente de « aucune bibliothèque
  trouvée ».

  **Le chemin « scan des sources » produirait des faux positifs sur le fixture
  lui-même.** `src/i18n.ts` y déclare `defaultNS: 'common'`, donc le code
  appelle `t('app.title')` sans préfixe alors que le chargeur indexe
  `common:app.title`. Le chemin « catalogue » — celui qui est prouvé — n'est
  pas concerné : les deux côtés portent le même préfixe.

  **Un `keySeparator` personnalisé n'est pas supporté** et produirait des clés
  manquantes fausses. Seuls `public/locales`, `locales` et `src/locales` sont
  cherchés.

  **La correction n'écrit que sous `locales/`**, alors que l'analyse lit aussi
  `public/locales` et `src/locales`. La liste blanche de chemins de
  `/v1/open-pr` exige `locales` comme premier segment, donc un dépôt dont les
  catalogues sont ailleurs est **analysable et non corrigeable** —
  `correctableDirectory` le dit avant de dépenser, plutôt que de le découvrir en
  400 une fois les traductions payées.

  **Un run perdu est perdu.** Le travail vit dans l'invocation ; si la fonction
  meurt, il n'y a ni file ni reprise. La borne est `MAX_CORRECTION_UNITS = 40`
  paires par livraison, posée avant que rien ne démarre — au-delà, la correction
  refuse avec une phrase plutôt que de commencer ce qu'elle ne finira pas.

  **Et l'hypothèse produit n'est toujours pas validée.** Le slice marche ; rien
  ne dit qu'il sert à quelqu'un. §C1 est intact : une organisation en
  production, celle du propriétaire, zéro entretien.

**Cette liste énumérait comme inexistants : base de données, comptes,
organisations, équipes, permissions, facturation, projets persistants, tableau
de bord. Sept des huit existent aujourd'hui** — Postgres, l'authentification,
les organisations, l'appartenance et les rôles, les projets, les runs et les
surfaces qui les lisent. Voir les seize migrations et les PR #14 à #23.

**N'existe toujours pas** : la **facturation**. Aucune intégration Stripe dans
le dépôt, et `/[org]/billing` le dit — « Paid plans are not priced yet ». Ce
n'est pas un oubli mais une conséquence : `docs/product/08-critique.md` §C3
interdit de publier un prix avant d'avoir modélisé le coût unitaire, et ce
modèle n'a pas été fait. C'est donc lui, et non le code de paiement, qui est sur
le chemin critique du « vendable ».

Ne jamais simuler ces fonctionnalités dans l'interface.

Voir `docs/product/`, `docs/design/`, `docs/frontend/` (PRD → jalons), et
`docs/product/08-critique.md` pour ce qui n'est pas encore solide.

**`apps/site` est déployé** sur https://localize-infra-site.vercel.app (projet
Vercel `localize-infra-site`, compte `drive-os-s-projects`, suivi de `master`).

**`apps/web` est déployé** sur https://localize-infra-web.vercel.app (projet
Vercel `localize-infra-web`, même compte, Root Directory `apps/web`, fonctions
en `cdg1`).

**`apps/api` est déployé** sur https://localize-infra-api.vercel.app (projet
Vercel `localize-infra-api`, Root Directory `apps/api`, fonctions en `cdg1`).

**Et il n'est pas relié à Git, contrairement aux deux autres.** Fusionner sur
`master` déploie le site et le web, pas l'API : elle se déploie par
`npx vercel deploy --prod --archive=tgz` (voir `apps/api/DEPLOYING.md`). Le
piège est que les trois projets se ressemblent sur cette page alors que deux
seulement suivent `master` — un correctif à `apps/api` fusionné n'est pas un
correctif en ligne. Constaté le 2026-08-23 : la PR #33 fusionnée, la dernière
production de l'API datait encore de la veille.

**Deux précisions sur cette commande, apprises en la lançant le 2026-10-01.**
Elle part de la **racine du dépôt**, pas d'`apps/api` — `DEPLOYING.md:142` le
dit, « so workspace dependencies resolve » — et avec `VERCEL_ORG_ID` et
`VERCEL_PROJECT_ID` en préfixe. Et `--archive=tgz` **transporte bien la
métadonnée Git** : `DEPLOYING.md` en doutait, puisque `VERCEL_GIT_COMMIT_SHA`
est une variable du système Git ; le déploiement répond pourtant un SHA réel.

**Le piège s'est reproduit, et la sonde qui le montre tient en une requête.**
Après la fusion de #128 puis #129, la page racine servait encore « Localize
Infra API ». Un HTML statique peut venir d'un CDN, donc ce n'est pas une
preuve ; ce qui en est une est une réponse **générée** : un jeton `lit_` bien
formé mais inexistant — le motif exige `lit_` plus exactement 43 caractères
base64url, un jeton plus court tombe sur le 401 générique et ne prouve rien —
atteint `auth.ts` et renvoyait l'ancien nom de produit. `/api/version`
confirmait : `55b3e2c`, le commit de #100. Après déploiement : `4a6f347`, et
les deux surfaces disent « Layersky ». Coût de la sonde : nul, le chemin est
non authentifié et n'atteint aucun modèle.

Ce sont les **trois** projets Vercel du dépôt. `services/github-app` reste une
bibliothèque, consommée par `apps/api` ; elle n'a pas de déploiement propre.

**`apps/web` est relié à Git.** Ce paragraphe disait le contraire — « le
déploiement est une archive envoyée par la CLI depuis la racine du dépôt » — et
prévenait que relier le projet rendrait le réglage « Include source files
outside of the Root Directory » indispensable. C'est fait, et c'était la bonne
prédiction : fusionner une PR sur `master` déclenche un déploiement de
production, et une PR ouverte déclenche une preview avec son check GitHub.
Observé le 2026-08-23 sur la PR #31.

**Cette phrase a été fausse du 2026-09-05 au 2026-09-12, et rien ne l'a
signalé.** L'App GitHub de Vercel avait perdu l'accès au dépôt. Le dernier
déploiement des deux projets est resté celui d'`e1c7adf` (2026-09-05 21:16 UTC) ;
la PR #86, fusionnée le 2026-09-12, n'a produit **ni déploiement, ni check-run
Vercel, ni même une preview** sur sa branche. L'accès a été rétabli à la main en
re-sélectionnant « All repositories ».

Ce qui rend le cas instructif, c'est que **tous les signaux habituels sont restés
verts** : la CI passait, les trois URL répondaient 200, et le site servait son
build de la semaine précédente sans rien en dire. Le seul témoin était une
*absence* — zéro deployment pour le commit — et une absence n'alerte personne.
Le contrôle qui l'a montrée est de demander le déploiement **du commit**
(`gh api repos/…/deployments`), pas la santé du site.

**Et le symétrique existe : un retard ressemble trait pour trait à une panne.**
Le 2026-09-18, la PR #105 n'avait ni deployment ni check Vercel quinze minutes
après son push, alors que les trois PR précédentes en avaient eu. Le lien Git
était intact, le compte ni bloqué ni en overage — et « l'App a encore perdu
l'accès » a quand même été écrit. C'était faux : Vercel a lancé le build à
**+20 minutes** et posé ses statuses à **+31**, sans que rien ne la débloque.

Ce qui sépare les deux cas n'est donc pas l'absence à un instant donné mais sa
**persistance** : la panne de septembre a duré sept jours et aucun push
ultérieur n'y changeait rien. Le contrôle reste le bon — demander le déploiement
du commit — mais il se relit **plus tard**, et les statuses du commit initial
suffisent à trancher après coup. Quinze minutes de sondage ne prouvent rien.

Le CDN le confirmait indépendamment, et c'est le contrôle le moins cher : sur
`localize-infra-site.vercel.app`, `Age` dépassait 5,6 jours **et continuait de
monter**, `Etag` inchangé. Un déploiement de production purge cette entrée et
remet `Age` à zéro ; tant qu'il grimpe, rien n'a été redéployé.

**Rétablir l'accès ne redéploie pas rétroactivement.** L'intégration réagit aux
événements de push, donc le commit fusionné pendant la panne est resté non
déployé après la reconnexion — il a fallu un push ultérieur, celui qui porte ce
paragraphe, pour que les deux projets repartent.

**L'épisode a révélé une asymétrie de vérifiabilité, et elle est corrigée.**
`apps/site` était contrôlable de l'extérieur — ses URL de déploiement sont
anonymes, donc l'alias se compare octet par octet à un déploiement *nommé*.
`apps/web` ne l'était pas : `ssoProtection` vaut `all_except_custom_domains`,
ce qui laisse l'alias ouvert mais place chaque `localize-infra-web-<hash>`
derrière le SSO Vercel — il n'y avait donc rien à quoi comparer l'alias. Et le
commit de reprise ne changeant rien sous `apps/web`, son build était identique
à l'octet près au build périmé : aucune comparaison de contenu ne pouvait les
distinguer. Il ne restait que la parole de Vercel.

`GET /api/version` répond désormais `{"commit":…,"environment":…}`, en public et
lu à l'exécution. `commit` vaut `null` hors Vercel plutôt qu'une valeur
fabriquée. L'ouverture de cette route est délibérée — la protection est une
liste blanche dans `lib/supabase/session.ts` — et `e2e/auth.spec.ts` vérifie
qu'elle répond déconnecté, avec `maxRedirects: 0` pour qu'une redirection vers
`/login` ne puisse pas passer pour un 200.

Le contrôle que ce paragraphe prescrivait a donc été rejoué, et il passe. Root
Directory est `apps/web`, et pourtant `bg-confident-bg` et
`text-ambiguous-text` — deux classes présentes dans `packages/ui/src` et
absentes d'`apps/web/src` — sont dans le CSS servi (184 611 octets sur deux
feuilles). Elles ne pourraient pas y être si la source hors Root Directory
n'était pas incluse : c'est une preuve par ce qui est servi, plus solide que la
lecture du réglage.

La conséquence pratique à retenir : **une modification de variable
d'environnement ne s'applique plus « au prochain déploiement CLI » mais à la
prochaine fusion.** Voir `apps/web/DEPLOYING.md` pour la commande CLI, qui
reste utilisable en secours.

**Ce paragraphe disait que seuls `SUPABASE_URL` et `SUPABASE_PUBLISHABLE_KEY`
étaient configurés, et que ni la clé privée de la GitHub App ni `LOCALIZE_API_*`
ne l'étaient. C'était faux depuis le 2026-08-19.** Vérifié par
`vercel env ls production` sur `prj_L5FZPh16GE88nLtgPbOnb2LR5e3f` : les
variables `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_ID`, `LOCALIZE_API_URL` et
`LOCALIZE_API_TOKEN` y sont. Le pipeline ne pointe donc plus sur
`127.0.0.1:8787` — c'est la conséquence du déploiement d'`apps/api` décrit plus
bas, et elle n'avait pas été reportée ici.

**Elles étaient neuf ; il en reste sept**, retirées le 2026-08-23 :
`GITHUB_OPERATOR_EMAILS` et `GITHUB_APP_INSTALLATION_ID`. Les sept qui restent
sont toutes lues par du code non-test d'`apps/web` — vérifié variable par
variable, c'est ce qui rend le nettoyage terminé plutôt qu'entamé.

Ce paragraphe disait que les deux « ne sont plus lues par rien ». C'était vrai
de la première et **faux de la seconde** : `apps/api/src/index.ts` la lit à
chaque démarrage, et `/v1/open-pr` ouvre toutes ses PR à travers elle. Elles
étaient mortes *dans le projet web*, ce qui n'est pas la même affirmation.
Retirer `GITHUB_APP_INSTALLATION_ID` du projet **API** couperait l'ouverture de
PR — `readGitHubAppConfig` renvoie `null` sans elle et la route répond 501.

**Et elle en a été retirée le 2026-09-17**, ce qui rend la phrase ci-dessus
périmée à son tour. Elle était vraie quand l'installation était une seule
configuration ; depuis que `GitHubAppConfig` est scindé (plus bas), la
variable n'est plus qu'un défaut facultatif — `readDefaultInstallationId`
rend `null` sans elle, et seule une requête **qui ne nomme aucune
installation** reçoit 501. Les deux appelants d'`apps/web` nomment toujours
celle du workspace (le type l'exige), et un jeton CLI personnel n'a jamais
de repli. Vérifié en production après le retrait, sans rien créer sur le
fixture : opérateur sans installation → 501 ; opérateur nommant `151289538`
avec un contenu identique à `main` → 409, donc GitHub est atteint ; jeton
`lit_` inconnu → 401. Retirée ensuite de Preview et Development : elle
n'existe plus nulle part sur le projet API.

**Le jeton opérateur a été changé le même jour**, `API_AUTH_TOKEN` (API) et
`LOCALIZE_API_TOKEN` (web) ensemble, en Production seulement, et
`API_AUTH_TOKEN` n'existe plus qu'en Production — un déploiement Preview de
l'API refuserait donc de démarrer. **La valeur en service est dans le `.env`
local, et nulle part ailleurs de lisible** : les variables `sensitive` ne se
relisent pas. La première rotation l'a appris à ses dépens — sa seule copie
locale supprimée, il a fallu tout refaire. Écrire la valeur là où on la garde
**avant** de la poser sur Vercel.

La suppression ne prend effet qu'au déploiement suivant — et comme le projet est
relié à Git (voir plus haut), c'est la fusion de la PR #31 qui l'a produit.
Vérifié sur le déploiement qui en résulte : `/login` répond 200 et le CSS servi
est identique à l'octet près (184 611), donc retirer ces deux variables n'a rien
changé pour l'application. C'est la seule preuve qui compte, l'absence
d'appelant n'étant qu'un argument.

**Ce paragraphe disait que `GITHUB_OAUTH_CLIENT_ID` et
`GITHUB_OAUTH_CLIENT_SECRET` manquaient tous les deux. Le premier est configuré
depuis le 2026-08-23**, obtenu par `GET /app` authentifié comme l'App avec la
clé privée déjà présente dans `.env` : le `client_id` est public par
construction, il figure dans toute URL d'autorisation.

**Le secret, lui, n'était récupérable par aucune API** — GitHub ne l'affiche
qu'une fois, à la génération, dans les réglages de l'App. C'est cette asymétrie,
et non un oubli, qui a fait que la moitié de ce blocage était automatisable et
l'autre non.

**Il a été posé à la main le 2026-08-28, et ce blocage est tombé.** Ce passage
disait « le flux reste donc coupé et continue de le dire » ; ce n'est plus vrai.
`GITHUB_OAUTH_CLIENT_SECRET` est configuré sur le projet Vercel, donc
`readOAuthConfig()` renvoie la paire et `canInstall` est vrai.

La preuve n'est pas le réglage mais son résultat :
`organization_github_installations` a porté l'installation `151289538`
(`maxencerousseau38-prog`, compte utilisateur) pour `layersky`, connectée le
2026-08-28 à 12:26 **par le flux OAuth de l'interface** — le seul chemin qui
exige le secret, puisque c'est lui qui échange le `code` puis vérifie
l'installation contre le jeton de l'utilisateur. Une ligne posée en SQL aurait
exactement la même apparence en base ; c'est le propriétaire qui a confirmé le
chemin emprunté, et c'est pour ça que la question a été posée plutôt que
déduite.

**Cet identifiant est périmé, et la preuve ci-dessus tient quand même.** Ce
paragraphe disait au présent que la base porte `151289538` ; elle porte
`166148995` depuis le 2026-09-29, l'ancienne installation ayant été supprimée
et recréée pour débloquer l'acceptation des permissions — voir le slice
guardrail plus haut. Ce qui est démontré ici n'est pas un numéro mais qu'un
flux OAuth complet a écrit la ligne, et cette démonstration ne se rejoue pas :
la réinstallation, elle, s'est faite à la main.

Les deux réglages de l'App restent ni modifiables ni **lisibles** par API :
« Request user authorization (OAuth) during installation », et l'URL de callback
`https://localize-infra-web.vercel.app/github/callback`. Sonder
`login/oauth/authorize` ne les révèle toujours pas — GitHub redirige vers sa
page de connexion avant de valider `redirect_uri`, donc une URL enregistrée et
une URL inconnue répondent à l'identique. Mais ils sont désormais **constatés
corrects** au lieu d'être supposés : un flux qui va jusqu'à écrire la ligne
prouve les deux. C'est la preuve que le sondage ne pouvait pas donner.

**`apps/web/DEPLOYING.md` n'avait pas suivi** — son tableau portait encore
`GITHUB_OAUTH_CLIENT_SECRET` en « no » et la phrase « The one thing still
blocking self-serve ». Corrigé dans le même commit que ce paragraphe, pour que
les deux fichiers ne puissent pas diverger d'une PR.

**Deux projets Supabase, séparés depuis le 2026-08-17.** Développement et
tests d'acceptation : `localize-infra` (`aguwalokxfgtqbzmdjbs`). Production :
`localize-infra-prod` (`ijgheekdihgssktyweyy`). Les deux en `eu-west-3`.

**Ce compte a été faux deux fois, et « appliquées de part et d'autre » l'était
aussi.** Il a dit « seize », puis « vingt-neuf ». Au 2026-08-30 : trente
fichiers dans `supabase/migrations`, trente lignes appliquées en production, et
**trente-deux** en développement.

Les deux surnuméraires ne sont pas un retard de la production. Ce sont deux
correctifs appliqués en développement puis repliés dans la version finale avant
qu'elle n'atteigne la production — `project_target_locales_per_element_shape`
et `closer_sent_respects_optout_restore`. Le premier est celui que le
commentaire de `20260829000100` raconte : une contrainte qui acceptait
l'élément unique `'fr,de'`, prise en insérant la valeur et non en relisant
l'expression.

D'où la règle à retenir plutôt que le nombre : **compter les lignes des deux
côtés ne prouve pas l'égalité des schémas**, puisque les historiques divergent
légitimement. Ce qui la prouve est de comparer les objets. Vérifié le
2026-08-30 sur `projects` : `root_dir`,
`projects_root_dir_is_a_safe_subdirectory` et
`projects_target_locales_are_valid` sont bien présents en production.

**Ces deux projets n'en formaient qu'un**, et ce n'était pas un détail : le
compte semé par `supabase/seeds/dev-user.sql` — mot de passe écrit dans ce dépôt, fichier qui
précise « NOT for production » — s'authentifiait contre le déploiement public.
Vérifié, puis re-vérifié après la bascule : le même appel renvoie désormais
`Invalid login credentials`.

**Cette phrase ajoutait « La base de production ne contient aucun compte ».
Ce n'est plus vrai :** la base contient un compte, créé le 2026-08-18, qui a
créé l'organisation `layersky`. Ce n'est pas le compte semé, qui reste refusé.

**Ce décompte disait « un compte » ; il y en a deux au 2026-09-16.** Le second
a été créé le 2026-08-28, son adresse est confirmée, il **ne s'est jamais
connecté** et n'appartient à aucune organisation. Il n'est pas identifié, et
l'épisode plus bas — un compte déduit « tiers » à partir de son domaine — est la
raison de ne rien en conclure : ni un utilisateur, ni un doublon du
propriétaire, tant que le propriétaire ne l'a pas dit. L'adresse n'a pas été
lue pour cet audit.

**Ce paragraphe a affirmé qu'il s'agissait d'un « compte tiers réel » et que
c'était « la donnée la plus utile que ce dépôt possède ». C'était faux.** Le
compte appartient au propriétaire — confirmé par lui le 2026-08-23, et
recoupé par le fait que `npm whoami` renvoie `layersky`. Il avait été lu comme
une inscription indépendante parce que l'adresse est sur un autre domaine que
celui habituel du propriétaire : une déduction à partir d'un domaine e-mail,
écrite comme un fait sur un inconnu, sans rien vérifier.

**Ce paragraphe décrivait ensuite un tunnel qui se termine en cul-de-sac** —
un workspace arrivant sur `/layersky/projects` et lisant que connecter GitHub
n'est pas disponible sur ce déploiement, avec pour seule porte de sortie « le
CLI fonctionne toujours sur un clone local ». C'était vrai, et ça ne l'est plus
depuis le 2026-08-28 : le secret OAuth est posé, le bouton s'affiche, et le
tunnel a été parcouru en entier le 2026-08-29 — connexion GitHub, projet,
langues cibles, run, pull request fusionnée.

**Ce passage nommait deux bloquants : le secret OAuth et la publication du
paquet. Les deux sont tombés le 2026-08-28.** Le CLI est sur npm, donc la porte
de sortie n'exige plus de cloner quoi que ce soit pour obtenir la commande —
elle reste étroite, traduire demandant une API que le lecteur héberge lui-même.
Et le secret OAuth est configuré, donc un workspace peut connecter sa propre
installation depuis l'interface au lieu de lire qu'il ne peut pas.

**Ce qui reste sur le chemin du « vendable » n'est donc plus technique.** Le
parcours complet — inscription, connexion GitHub, projet, langues, run, pull
request — est franchissable depuis l'interface pour un dépôt **public**, et
**guidé** depuis #102 plutôt que seulement possible : `/[org]/start` nomme
l'étape suivante et ce que chaque refus veut dire (voir `apps/web` plus haut).
Ce qu'il fallait deviner de l'ordre ne se devine plus.

Deux réserves, et ce sont des faits, pas des nuances. Un dépôt **privé** exige
encore `organization_entitlements.private_repositories`, qui n'a aucun chemin
produit et se pose à la main : c'est ainsi que `layersky` a pu viser le fixture,
qui est privé — accordé le 2026-08-28, `plan` laissé à `free`, aucune
facturation derrière, et le `granted_reason` de la ligne le dit. Et personne ne
peut payer, ce qui est le sujet du paragraphe sur la facturation plus haut.

**Il n'existe toujours aucune preuve que quiconque hors de ce projet le
veuille.** `docs/product/08-critique.md` §C1 — zéro recherche primaire, personas
inventés — reste entièrement valable.

La phrase « NOT for production » n'empêchait rien, donc la règle est maintenant
appliquée et non plus écrite. La base de production porte une marque posée hors
migration — `comment on database postgres is 'localize-infra-production'` ;
hors migration parce qu'une migration se rejoue aussi en développement et ne
distinguerait donc pas les deux. Le seed lit cette marque et refuse de
s'exécuter. Testé dans les deux sens : il lève une exception sur la production,
il passe sur le développement.

Le troisième emplacement de projet a été libéré en **suspendant** le projet
ReFrame (`ngbxfpsfmjagauavbuhd`, vide — 0 ligne sur ses six tables). C'est
réversible par `restore_project` ; si ReFrame en a de nouveau besoin, il faudra
arbitrer l'emplacement.

**Écart connu — mots de passe compromis.** La protection contre les mots de
passe fuités (corpus HaveIBeenPwned) est réservée au plan Pro de Supabase, et
l'organisation est en plan gratuit : elle **n'est pas activable**, ce n'est pas
un oubli. Le remplacement est plus faible et vit dans
`packages/schemas/src/password.ts` : minimum de 12 caractères, refus au-delà de
72 octets (bcrypt tronque en silence au-delà), refus d'un mot de passe qui
contient l'adresse e-mail. Pas de règles de composition — NIST SP 800-63B ne les
recommande plus, elles produisent `Password1!`. Un mot de passe de 12 caractères
présent dans un corpus de fuite passe donc encore ; seul le plan Pro corrige ça.

La règle ne s'applique qu'à la **création de compte**. L'imposer à la connexion
enfermerait dehors les comptes antérieurs — un test e2e garde ce point, parce
que le champ mot de passe est partagé par les deux boutons et qu'un `minLength`
sur cet input aurait exactement cet effet.

Cette phrase a déjà été fausse, et pas qu'un peu : un projet
`localize-infra-api` a existé sur le même compte et redéployait `apps/api` à
chaque push pendant que ce fichier affirmait « reste local ». Il répondait 500
sur toutes les routes — `API_AUTH_TOKEN` absent côté Vercel, et
`apps/api/src/index.ts` refuse de démarrer sans lui : le fail-closed voulu, qui
a transformé l'oubli en URL publique morte plutôt qu'en API ouverte. Projet
supprimé le 2026-08-14.

**C'est arrivé, le 2026-08-19, sur décision explicite.** Ce paragraphe disait
que redéployer `apps/api` « n'est pas un geste neutre » et que, le cas échéant,
il se mettrait à jour dans le même commit. Voici cette mise à jour.

L'écart connu à l'invariant 5 n'est donc plus sur le poste du développeur : le
service tourne sur une URL publique et envoie du contexte extrait du code source
— chemins de fichiers, noms de composants, code environnant — à Anthropic, hors
UE, à chaque traduction. Les fonctions sont en `cdg1` et la base est en
`eu-west-3`, ce qui règle le trajet jusqu'au modèle, pas le modèle lui-même.
`apps/api/public/index.html` le dit aussi à qui visite la racine du service.

Ce qui rend le déploiement tenable plutôt qu'imprudent, c'est le fail-closed :
`apps/api/src/index.ts` refuse de démarrer sans `API_AUTH_TOKEN`, toutes les
routes `/v1/*` exigent le bearer (vérifié en production : 401 sans jeton, 401
avec un mauvais jeton), et `/health` est la seule route publique. Les cinq
variables sont cette fois configurées — l'oubli de 2026-08-14 est précisément
ce que cette liste empêche de répéter.

Aucun domaine personnalisé n'est attaché. `SITE_URL`
(`apps/site/src/lib/routes.ts`) porte cette origine, et tout ce que le site
déclare sur lui-même en découle — canonique, `metadataBase`, sitemap, robots.
Y attacher un domaine, c'est changer cette seule ligne : la laisser périmée est
exactement ce qui a fait pointer la canonique de chaque page vers
`localize-infra.dev`, un domaine jamais enregistré, pendant tout le premier
déploiement.

`docs/deploying.md` donne les réglages Vercel et le
piège qui casse le site en silence : sans « Include source files outside of the
Root Directory », la directive `@source` de Tailwind ne trouve plus
`packages/ui/src`. Le build passe au vert et **30 % de la feuille de style
disparaît** (44,4 ko → 30,9 ko, mesuré) : les composants partagés perdent leurs
utilitaires alors que la mise en page tient encore — donc ça ne se voit pas au
premier coup d'œil. `docs/releasing.md` couvre la publication npm — il disait
« rien n'est publié », les trois paquets le sont depuis le 2026-08-28.

M1 Phase 1 (`packages/core`, `packages/cli`) — voir
`docs/superpowers/specs/2026-08-02-m1-npx-to-pr-design.md` et
`docs/superpowers/plans/2026-08-02-m1-phase1-core-cli.md`.

M1 Phase 2 (`apps/api`, `services/github-app`) — **la GitHub App existe et
fonctionne.** Ce paragraphe a longtemps dit « en attente de la GitHub App créée
par un humain (Task 6) » ; c'était faux. Les identifiants sont dans `.env`
(gitignoré) et l'installation atteint deux dépôts, vérifié :
`maxencerousseau38-prog/localize-infra` et
`maxencerousseau38-prog/localize-infra-fixture-vite` — ce dernier étant
exactement le dépôt de la PR réelle affichée sur la landing.

**L'installation est stockée par organisation, plus par déploiement.** Ce
paragraphe décrivait une installation unique partagée, et disait que la
connexion d'un dépôt était « réservée aux opérateurs (`GITHUB_OPERATOR_EMAILS`) ».
Les deux moitiés étaient fausses au moment où elles ont été écrites.

`organization_github_installations` porte l'`installation_id` par organisation
depuis la migration `…0817000600`, et `resolveInstallation` ne sait plus rien
dire d'autre : le type ne peut plus exprimer « agir comme l'installation
partagée ». Un workspace sans installation propre n'a donc pas d'accès GitHub —
ce n'est pas un cas qui échoue proprement, c'est un cas qui ne compile pas.

Quant au garde-fou : `isOperator` et `operatorInstallationId` **n'avaient aucun
appelant**, ni l'un ni l'autre, alors que trois commentaires affirmaient que
tout appelant vérifiait le premier. Ce n'était pas une faille — le chemin qu'ils
gardaient était inatteignable — mais une liste blanche qui n'appliquait rien,
décrite à trois endroits comme ce qui séparait les locataires. Les deux sont
supprimés ; l'isolation était structurelle et l'est maintenant explicitement.

**L'écriture emprunte désormais la même installation que la lecture.** Ce
paragraphe disait « sur le chemin de lecture seulement », et c'était exact :
la PR n'est pas ouverte par `apps/web` mais par `apps/api`, qui n'acceptait
**aucun** `installation_id` et sortait donc *toutes* les PR de *tous* les
locataires par l'installation unique de l'opérateur. Un client ayant connecté la
sienne aurait traduit puis échoué au dernier pas — celui qui est le premier
livrable (invariant 2).

Corrigé : `/v1/open-pr` accepte un `installationId` optionnel et agit comme lui ;
les deux appelants d'`apps/web` résolvent l'installation du workspace et
l'envoient. `GITHUB_APP_INSTALLATION_ID` cesse d'être *l'*installation pour
devenir un **défaut**, ce qui garde `packages/cli` fonctionnel contre un
`apps/api` auto-hébergé. **La production n'a plus ce défaut depuis le
2026-09-17** : le jeton opérateur ne peut plus ouvrir de PR sans nommer une
installation. `GitHubAppConfig` a été scindé en identifiants et
installation — le même découpage qu'`apps/web` a fait en #24, pour la même
raison : fusionner « ce qu'est l'App » et « quelle installation » est ce qui ne
laissait aucune place au choix.

Ce qui reste, et qui est une garantie portée par le client et non par le
service : `apps/api` authentifie un jeton, pas un workspace, donc il ne peut pas
vérifier que l'installation nommée appartient à l'appelant. `apps/web` la dérive
de l'organisation et détient seul `LOCALIZE_API_TOKEN`. Le garde-fou de dernier
recours est celui de GitHub — un jeton d'installation n'atteint que ce que cette
installation s'est vu accorder.

Il ne manque donc plus qu'une chose côté GitHub pour le multi-locataire :
**le secret OAuth**, sans lequel aucun client ne peut déclencher sa propre
installation — et le bouton est absent plutôt que désactivé.

**Écart connu à l'invariant 5 (résidence des données UE) :** cette phase
envoie du contexte extrait du code source (chemins de fichiers, noms de
composants, code environnant) à des fournisseurs LLM non hébergés dans l'UE
(Anthropic, OpenAI) pour la traduction — voir `packages/cli/README.md`. Il
s'agit d'un compromis délibéré et documenté pour ce jalon pré-alpha, pas
encore résolu, et à traiter quand la résidence des données UE sera
réellement adressée.

## Avant toute UI

**`DESIGN.md` à la racine fait autorité.** Ce point ne le citait pas, alors qu'il
se déclare *« this document is the contract »* : 692 lignes, seize sections, et
un §16 qui tranche la question à laquelle ce paragraphe répondait mal — *« une PR
qui introduit une valeur absente de ce document est incomplète : soit elle
emploie un token existant, soit elle amende ce document d'abord, avec le
raisonnement. »*

L'ordre d'autorité est celui que §15 énonce : `DESIGN.md` → le langage visuel de
Localize Infra → l'architecture de `packages/ui` → les primitives externes.

Ce que ce point demandait — produire un plan de design (palette, typo, layout,
signature) avant le CSS — **est déjà fait, et le refaire est le défaut, pas la
méthode.** La palette, l'échelle typographique en deux registres et la signature
(§1.4 : la State Rule, l'Iris réservé au seul « votre jugement est requis », le
pipeline en cinq étapes) sont décidées et testées. Un chantier UI produit donc
un plan de *composition* — quelles surfaces changent, contre quelles sections du
contrat — et non une identité neuve.

Reste vrai et vaut d'être relu : éviter les défauts IA du skill, dont l'accent
#D97757. `DESIGN.md` §1.3 et §14 vont plus loin et sont, eux, opposables.

Le skill : `frontend-design` (plugin `claude-plugins-official`), à invoquer par
son nom. **Ce point donnait `/mnt/skills/public/frontend-design/SKILL.md`, qui
n'existe pas sur cette machine** — l'instruction était donc insuivable telle
qu'écrite, et c'est en la suivant qu'on s'en aperçoit.

## MCP
Supabase : migrations, types, RLS (get_advisors systématique). Jamais les traductions.
Vercel : deploy, build logs, runtime errors.
Stripe : prix récurrents fixes uniquement. Jamais `metered`.
21st : primitives dashboard. Figma : seulement si design system existant.

## Open source
**Le fichier `LICENSE` à la racine fait foi** : il délimite explicitement les
deux licences et énumère les chemins réels. Ne pas laisser cette section diverger.

Ouverts (MIT) : `packages/cli`, `packages/core`, `packages/eval`,
`packages/schemas`. Chacun porte sa propre copie du texte MIT, pour que la
licence voyage avec le code publié ou copié.

Propriétaires (tous droits réservés) : `packages/pricing`, `packages/ui`,
`apps/api`, `apps/site`, `apps/web`, `services/github-app`. Chacun porte un avis explicite, pour qu'on ne
puisse pas supposer que le MIT de la racine s'applique en parcourant un dossier.

**Tout ajout est propriétaire par défaut**, sauf s'il est placé dans l'un des
chemins ouverts ci-dessus ou que `LICENSE` est amendé. `adapters` et `sdk-*`
sont prévus comme ouverts mais n'existent pas encore.

Le cœur ouvert doit être utilisable seul.

## Tests obligatoires en CI
Intégrité placeholders/ICU ≥ 99,5 % (packages/eval, condition B).
Harnais d'éval rejoué à chaque changement de modèle ou de prompt.

## Les gates — `npm run gates`

**Une seule commande, dans cet ordre : lint → typecheck → test → test:e2e.**
Lancer les quatre. Pas trois.

Ce script existe parce que la mémoire ne suffit pas : une session entière a
tourné en lançant lint, typecheck et les deux suites e2e après chaque
changement, sans jamais rejouer les tests unitaires. Un test de `packages/ui`
est resté rouge pendant deux commits.

Deux pièges rendent un gate vert alors qu'il ne l'est pas. Les deux ont
frappé, les deux sont désormais corrigés à la cause — mais il faut savoir
qu'ils existent, parce que leur symptôme est **un succès**, jamais une erreur.

1. **Le cache turbo.** `type-scale.test.ts` (packages/ui) lit `apps/site/src`
   et `apps/web/src`, alors que la clé de cache par défaut ne couvre que
   `packages/ui`. Une violation commise dans une app ne déplaçait pas la clé et
   turbo rejouait le dernier succès. Corrigé par `packages/ui/turbo.json`, qui
   déclare ces répertoires en `inputs`. En cas de doute : `--force`.
2. **Un serveur resté vivant.** Les deux configs Playwright ont
   `reuseExistingServer` hors CI, donc un `next start` oublié répond encore —
   et si un build a réécrit `.next` sous lui, la suite échoue partout pour des
   raisons sans rapport avec le diff, ou pire, passe sur du code qui n'est plus
   là. Tuer les ports 3210/3211 avant une campagne e2e.

**Un troisième piège, et celui-là ne tient pas à l'outillage.** Le 2026-10-01
une erreur de format a atteint une branche poussée et c'est CI qui l'a trouvée,
alors que `npm run lint` la signalait en local depuis plusieurs tours. La cause
était la façon de lancer le gate : `npm run lint` et `turbo run …` enchaînés
dans une seule commande terminée par un `tail`/`Select-Object -Last 2`, dont les
dernières lignes sont **toujours celles de turbo**. Le verdict de lint défilait
sans être lu, et « 0 erreur » a été rapporté depuis une sortie que personne
n'avait regardée.

La règle qui en sort, et qui vaut au-delà de ce cas : **un gate dont on ne lit
pas le résultat n'est pas un gate.** Lancer chaque commande séparément, ou lire
assez de lignes pour voir le verdict de chacune — c'est le même motif que le
cache turbo et le serveur resté vivant, avec un humain à la place de l'outil.

Détail au passage : les fins de ligne comptent. Biome signalait trois fichiers
dans l'arbre de travail (CRLF) contre un seul en CI (LF) ; un seul écart était
réel, les deux autres étaient de la normalisation que git absorbe.

CI (`.github/workflows/ci.yml`) fait tourner les mêmes gates, avec `npm ci`
dans les deux jobs.

**Le job `e2e` démarre sa propre base, et c'est ce qui a rendu 48 tests
visibles.** `data-surface`, `workspace` et `auth` se sautent eux-mêmes sans
`SUPABASE_URL` — 48 tests que la CI n'a jamais exécutés, en restant verte tout
du long. C'est exactement ainsi que le trou a survécu : le job passait en ne
prouvant rien d'eux.

La pile Supabase est désormais lancée **dans le job** par `npm run db:local`,
reçoit **toutes** les migrations du répertoire puis le seed, et meurt avec lui.
Ce nombre était écrit ici — « les 36 » — et il était faux dès la migration
suivante ; il y en a 39 au 2026-09-24. Un compte figé dans une phrase que rien
ne relit est périmé par le prochain commit qui en ajoute une, et il n'apprend
rien de plus que « toutes ». Ce n'est pas un pis-
aller faute de projet hébergé disponible — c'est **plus** isolé : aucun secret
n'est ajouté, les clés locales étant publiques par conception, et deux PR
simultanées ne partagent aucune ligne. Un projet dédié aurait rejoué, à
l'échelle du dépôt, la course que `workspace.spec.ts` avait déjà dû contourner
en se donnant son propre projet.

**Une étape échoue si `SUPABASE_URL` est vide**, et c'est elle qui vaut plus que
le câblage : sans elle, une base cassée reproduit l'état d'avant — 48 tests
sautés, suite verte, rien de prouvé.

**Les migrations sont rejouées depuis une base vide à chaque exécution.** Les
deux bases hébergées ont été construites migration par migration et n'avaient
jamais été reconstruites ; c'est la première preuve continue que la séquence
est rejouable.

**96 assertions de base de données tournent** — 47 dans
`closer-suppression.sql`, 23 dans `tenant-isolation.sql`, 20 dans
`cli-tokens.sql`, 6 dans `role-permissions.sql`. Elles ne sont pas du pgTAP : chacune finit par un
`raise` délibéré qui annule la transaction, donc **elles sortent en échec quand
elles réussissent**. `supabase/tests/run.sh` lit le verdict et compare chaque
paire à ce qu'elle attendait ; ni le code de sortie ni la présence du marqueur
ne suffisent, puisqu'un script qui avorte à mi-course produit les deux.

**Ce compte disait 39, et l'écart n'était pas de nouvelles assertions.** 21
existaient déjà et n'étaient pas vérifiées : `run.sh` lisait `=[tf](want [tf])`
et abandonnait en silence toute paire dont la valeur n'était pas booléenne. Dans
`tenant-isolation.sql` cela retirait `creator-role=owner` et **toutes** les
lectures inter-locataires — `B-sees-A-org`, `B-sees-A-proj`, `B-sees-A-members`,
c'est-à-dire ce que ce fichier existe pour prouver. `B-sees-A-proj=1(want 0)`
aurait été rapporté « ok — 7 check(s) ». La comparaison était en outre fausse
au-delà d'un caractère, ne lisant que le premier de chaque côté : `count=10(want
1)` passait.

Le défaut n'a été vu que parce que `role-permissions.sql` est entièrement
numérique, donc rien n'y matchait et il a déclenché « verdict line carries no
checks » — la garde prévue pour les scripts avortés, qui a fait le travail par
accident sur un script parfaitement déroulé. **Une garde qui ne mesure qu'une
partie de ce qu'elle annonce ne se signale pas : son symptôme est un succès.**
C'est le même motif que le cache turbo et le serveur resté vivant, plus haut.

**Quatre défauts trouvés, tous de la même famille.** Le seed n'allait jamais
jusqu'au bout — sa dernière instruction citait une variable d'un autre bloc.
Turbo filtrait l'environnement et il a fallu déclarer les variables sous
`test:e2e`. Le seed ignorait le locataire `intruder-co` entier. Et les deux
tests d'isolation visaient des slugs inventés : ils passaient sur n'importe
quelle base, vide comprise, sans rien prouver de ce que leurs noms annonçaient.
Chacun n'existait que parce que personne n'avait jamais rejoué le seed.

**Ce qui n'est toujours pas couvert**, et il faut le dire : la suite exerce des
lignes semées, pas GitHub ni le modèle. Le job pose des identifiants d'App
GitHub **fabriqués**, ce qui fait prendre à la page la bonne branche sans
qu'aucun appel réel soit possible — aucune organisation semée n'a
d'installation, donc Octokit n'est jamais construit. Un run réel, une PR réelle
et une traduction réelle restent des vérifications manuelles.

**Les fonctions `SECURITY DEFINER` ont été relues une par une le 2026-09-16.**
Le conseiller Supabase en signale 32 appelables par `authenticated`, et il le
signalera toujours : l'app les appelle avec la session de l'utilisateur, donc
les révoquer casserait le produit. Ce qui les protège est leur garde interne —
relire la ligne visée, puis vérifier l'appartenance de l'appelant à
l'organisation **de cette ligne**. Trente la portent, ou ne lisent que les
droits de l'appelant lui-même (`is_org_member`, `org_role`,
`create_organization`).

Deux ne la portaient pas.

- **`closer_is_suppressed`** répondait à tout utilisateur connecté, pour
  n'importe quelle organisation : un oracle sur la liste d'opposition d'un
  autre tenant. Fuite constatée sur la base de dev avant correction
  (`B-probe-A-suppressions-blocked=f`), fermée par
  `20260916000100`, prouvée dans `tenant-isolation.sql`. La garde **lève**
  au lieu de répondre `false` : ses appelants décident d'écrire ou non à
  quelqu'un, et « non supprimé » est la valeur dangereuse.
- **`link_github_installation`** vérifie que l'appelant est owner ou admin
  de *son* organisation, **pas qu'il contrôle l'installation qu'il nomme**.
  Cette preuve n'existe que dans le callback OAuth d'`apps/web`. Un appel
  direct à `rpc/link_github_installation` pourrait donc rattacher
  l'installation d'un autre client — et notre App y a `contents: write`.
  **Non exploitable de l'extérieur aujourd'hui** : la clé publishable
  n'atteint pas le navigateur (vérifié sur les bundles servis). Mais Supabase
  la documente comme publique, et une garde qui repose sur sa non-diffusion
  n'en est pas une.

  **Et la garde elle-même laissait passer les non-membres.** Elle s'écrivait
  `org_role(org) not in ('owner','admin')` ; `org_role` rend `NULL` pour
  un non-membre, `NULL not in (…)` vaut `NULL`, et un `IF` PL/pgSQL ne
  prend pas une branche `NULL`. Reproduit sur dev : un utilisateur extérieur
  à A a **écrit** le lien GitHub de A (`rows-written-into-A=1`) et
  `unlink_github_installation` l'a supprimé de même. `role-permissions.sql`
  ne l'a jamais vu parce qu'il testait un *membre*, dont le rôle n'est pas nul.
  La production ne portait qu'un lien, posé par l'owner via OAuth.

  **Corrigé par l'option retenue par le propriétaire, la clé `service_role`**
  (`20260916000200`). Les deux fonctions ne sont plus exécutables que par
  `service_role`, prennent l'utilisateur en paramètre et vérifient son rôle en
  traitant `NULL` comme un refus. Le callback vérifie la propriété auprès de
  GitHub, lit l'utilisateur par `getUser()`, puis écrit avec
  `SUPABASE_SERVICE_ROLE_KEY` (`lib/supabase/admin.ts`, seul usage de cette
  clé). 8 contrôles de plus dans `tenant-isolation.sql`.

  **La leçon qui dépasse ce cas : une garde `not in` sur une valeur qui peut
  être `NULL` laisse passer exactement ceux qu'elle vise.** Écrire
  `is null or … not in`, et tester un non-membre, pas seulement un membre.

  **Sans la clé sur Vercel, connecter un *nouveau* compte GitHub échoue fermé** :
  le bouton disparaît et `SUPABASE_SERVICE_ROLE_KEY` est nommée dans la liste
  des manques. Les liens existants sont lus sous RLS et ne sont pas touchés.

**`package-lock.json` doit être généré sous Linux.** C'est la seule contrainte
non évidente de ce dépôt côté dépendances, et elle a coûté cinq jours de CI
rouge : npm élague les paquets optionnels de plateforme qui ne correspondent
pas à la machine qui écrit le lockfile (npm/cli#4828). Généré sous Windows, il
ne contenait que `@rollup/rollup-win32-*` et `@esbuild/win32-x64` ; `npm ci`
sous Linux installait donc un arbre sans binaire rollup, et vitest mourait
avant sa première assertion. Le job `e2e` passait pendant tout ce temps — Next
compile avec swc, présent en Linux dans le lockfile — d'où un badge vert à côté
d'un badge rouge, que personne n'a lu.

L'asymétrie n'est pas réciproque, et c'est ce qui rend la règle utilisable : un
lockfile écrit sous **Linux** contient la matrice complète des deux
chaînes — win32 compris — donc il s'installe sur les deux plateformes. Vérifié
par sonde avant adoption, puis par un `npm ci` réel sous Windows.

Deux impasses, pour ne pas les refaire :

- `npm install --package-lock-only` sur un lockfile existant **n'ajoute pas**
  les entrées manquantes, sous Linux comme sous Windows ;
- `--os=linux --cpu=x64` ne produit aucun diff.

Seule une régénération complète fonctionne, et elle **re-résout les versions**
dans les plages de `package.json`. Celle-ci en a déplacé 77, dont
`@hono/node-server` 1.19.17 → 2.1.1 (majeure). Les gates passent, mais si un
jour vous régénérez : lisez le diff, il n'est jamais uniquement plateforme.

### Protection de branche

`master` exige les deux checks — `test` **et** `e2e` — avant qu'une pull
request puisse être fusionnée. Force-push et suppression de la branche sont
bloqués.

Le pourquoi : pendant cinq jours le badge `e2e` est resté vert à côté d'un
badge `test` rouge, et personne ne l'a lu. Le signal existait ; ce qui manquait
était l'obligation de le regarder. Exiger les deux, et pas seulement l'un,
c'est précisément ce qui empêche qu'une moitié verte serve d'alibi à l'autre.

**`enforce_admins` est à `true`.** La règle s'applique au propriétaire comme à
tout le monde : **`git push origin master` est refusé**, y compris pour un
admin. Tout passe désormais par une branche et une pull request. Tout
l'historique du dépôt jusqu'à `4ece793` a été poussé en direct ; ce n'est plus
possible.

Le flux :

```
git switch -c <branche>
git push -u origin <branche>
gh pr create --fill
gh pr checks --watch      # test + e2e doivent passer
gh pr merge --squash --delete-branch
```

**Le piège à connaître, parce qu'il s'est déjà produit ici :** si CI casse pour
une raison d'infrastructure — c'est arrivé cinq jours durant, le job `test` ne
démarrait même pas — alors *plus rien ne peut être fusionné*, y compris le
correctif de CI lui-même. La sortie est de désactiver temporairement la
contrainte, fusionner le correctif, la remettre :

```
gh api -X DELETE repos/.../branches/master/protection/enforce_admins
gh api -X POST   repos/.../branches/master/protection/enforce_admins
```

`strict` est à `false` : une branche n'a pas besoin d'être à jour avec `master`
avant fusion. Sur un dépôt à un seul auteur, l'exiger ne force que des rebases.

## Frontend defaults

**`DESIGN.md` décide. Une dépendance UI ou d'animation s'ajoute uniquement
lorsqu'elle résout un besoin réel du produit et qu'elle respecte ce contrat.
Jamais pour obtenir un effet décoratif.**

Avant d'en ajouter une : la primitive existe-t-elle déjà dans `packages/ui` ?
Le besoin est-il exprimable avec les tokens et les variantes déjà là ? Si oui,
la réponse est non.

**Ce point imposait Lenis, GSAP et React Bits « pour tout site, landing page,
dashboard ou frontend React/Next.js ».** Remplacé le 2026-09-19, pour deux
raisons vérifiées plutôt que supposées.

Aucune des trois n'était installée ni importée nulle part — zéro manifeste,
zéro import — donc la règle prescrivait depuis le début un outillage que le
dépôt n'a jamais eu. Et elle contredisait `DESIGN.md` §7.2, qui interdit les
reveals au scroll, le parallax, les entrées échelonnées et « anything
decorative » : le défilement fluide et les timelines existent essentiellement
pour ce que cette section bannit.

Une règle qui impose l'inverse du contrat ne départage rien — elle donne à
chaque camp une phrase à citer. `DESIGN.md` §15 fixe déjà l'ordre d'autorité,
et §17 enregistre l'arbitrage qui a produit ce remplacement.

Ce qui reste vrai et n'a pas bougé : respecter `prefers-reduced-motion`,
préférer `transform` et `opacity`, et ne pas écrire un défilement fluide maison
là où le navigateur suffit. **Ne jamais retirer une dépendance réellement
utilisée sans audit préalable** — celles-ci ne l'étaient pas, ce qui est
précisément ce qui rendait le retrait sûr.