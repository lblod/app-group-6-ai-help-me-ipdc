/**
 * I know.  I knoow.  I KNOOOOW.  Yes, I do know running a microservice
 * in development mode so I can overwrite a file isn't ok.  It is
 * beyond rediculous.  But I have to wait for 10 minutes now while it
 * fetches, so let me explain what is going on.
 *
 * The LDES client does not support local files.  It probably shouldn't
 * because fetching local files is a risk.  We could have hosted the
 * files on a random domain too but making the ldes-client support
 * local file downloads was too much fun to _not_ try it.  But that
 * made it exist and this is the best place to put that code.
 *
 * We only really override rdflib's fetcher in a dirty way here.  The
 * rest is the sources as they already existed.
 *
 * I did not bother figuring out what the exact necessary change would
 * need to be, I just assumed we would get a file:// link and fetch that
 * from the database.  These sources will not work with real URLs but
 * it's a hackathon and I don't think I want the feature there.
 *
 * And with that, it seems to be loading and we're one step closer.
 */
import { uuid } from 'mu';
import { CronJob } from 'cron';
import { logger } from './logger';
import { querySudo, updateSudo } from '@lblod/mu-auth-sudo';
import { URL } from 'url';
import { DIRECT_DATABASE_CONNECTION, GRAPH_STORE_URL, LDES_BASE, WORKING_GRAPH, FIRST_PAGE, CRON_PATTERN, BYPASS_RDFLIB, EXTRA_HEADERS } from './environment';
import { batchedProcessLDESPage } from './batched-page-processor';
import { StateInfo, gatherStateInfo, loadState, runningState, saveState, streamIsAlreadyUpToDate } from './manage-state';
import { handleStreamEnd } from './config/handleStreamEnd';
import fs from 'fs';

const rdflib = require('rdflib');

async function determineFirstPage(): Promise<StateInfo> {
  const state = await loadState();
  if(!state){
    return {
      lastTime: new Date(),
      lastTimeCount: 0,
      currentPage: FIRST_PAGE,
      nextPage: null,
    };
  }
  return state;
}

async function determineNextPage() {
  const page = await querySudo(`SELECT ?page WHERE { GRAPH <${WORKING_GRAPH}> {
    ?relation a <https://w3id.org/tree#GreaterThanOrEqualToRelation> .
    ?relation <https://w3id.org/tree#node> ?page.
  } }`);

  if(page.results.bindings.length === 0) {
    return null;
  }

  return new URL(page.results.bindings[0].page.value, LDES_BASE).href;
}

async function clearWorkingGraph() {
  await updateSudo(`DROP SILENT GRAPH <${WORKING_GRAPH}>`, {}, {sparqlEndpoint: DIRECT_DATABASE_CONNECTION});
}

async function loadLDESPage(url: string) {
  logger.info(`Loading LDES page ${url}`);

  let turtle;
  if (BYPASS_RDFLIB) {
    const response = await fetch(url, {
      headers: {
        Accept: 'text/turtle',
        ...EXTRA_HEADERS,
      },
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch LDES page ${url}, status ${response.status}, ${await response.text()}`);
    } else {
      turtle = await response.text();
    }
  } else {
    const store = rdflib.graph();
    const fetcher = new rdflib.Fetcher(store);
    const headers = new Headers(EXTRA_HEADERS);

    // !! YOU'VE READ THE DIRTY BIT, THE REST IS WHAT IT IS !!

    // We override _fetch here which is what is used to execute the
    // fetch in rdflib internally.  Instead of making a call, we fake a
    // response.  Second argument for response was partially found
    // online and this makes it happy.  It's a one off import for a
    // hackathon, not living code.

    fetcher._fetch = async (url, options) => {
      return new Response(
        (await fs.promises.readFile( (new URL(url)).pathname )),
        { status: 200, statusText: 'OK', url, headers: { "Content-Type": "application/ld+json" } });
    }

    // !! YOU'VE READ THE DIRTY BIT, THE REST IS WHAT IT IS !!

    await fetcher.load(url, { headers });

    const replacedIdentifiers = {};
    store.match().forEach((stmt) => {
      ['subject', 'predicate', 'object'].forEach((property) => {
        if (stmt[property].termType == 'BlankNode') {
          stmt[property] =
            replacedIdentifiers[stmt[property].id]
            ||= new rdflib.NamedNode(`http://blanknodes.semantic.works/${uuid()}`);
        }
      });
      // This is a particular case we noticed.  We did not check the
      // legality of this transformation but the original content seems
      // to be in one of the feeds we consume and the resulting file
      // cannot be parsed.  This transformation alters @nl/u to @nl-u
      // which Virtuoso accepts.
      if (stmt.object.language?.includes("/")) {
        stmt.object.language = stmt.object.language.replaceAll("/","-");
      }
    });
    turtle = rdflib.serialize(new rdflib.NamedNode(url), store);
    turtle = `@base <${url}> .\n${turtle}`;
  }

  logger.info(`Uploading LDES page ${url}`);
  try {
    const uploadRes = await fetch(`${GRAPH_STORE_URL}?graph=${WORKING_GRAPH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/turtle',
      },
      body: turtle,
    });
    if(!uploadRes.ok) {
      throw new Error(`Failed to upload LDES page ${url}`);
    }
  } catch (e) {
    console.log(`Failed to upload LDES page`);
    console.log(turtle);
    throw new Error(`Failed to upload LDES page ${url}`);
  }
  logger.debug(`LDES page ${url} uploaded`);
}

async function fetchLdes(){
  logger.info('Fetching LDES...');
  const startingState = await determineFirstPage();
  let currentPage: string | null = startingState.currentPage;
  let nothingToDo = false;
  while(currentPage) {
      await clearWorkingGraph();
      await loadLDESPage(currentPage);

      const state = await gatherStateInfo(currentPage);
      if (streamIsAlreadyUpToDate(startingState, state)) {
        logger.info('LDES is already up to date, not fetching more pages');
        nothingToDo = true;
        break;
      }
      await batchedProcessLDESPage();

      const nextPage = await determineNextPage();
      await saveState(state);
      currentPage = nextPage;
  }

  if(!nothingToDo){
    logger.info('LDES fetched, informing hook');
    await handleStreamEnd();
  }

  logger.info('LDES fetched, clearing working graph');

  await clearWorkingGraph();

  logger.info('LDES fetched, all done!');
}

export const cronjob = CronJob.from({
  cronTime: CRON_PATTERN,
  onTick: async () => {
    if(runningState.lastRun) {
      logger.debug('Another job is already running...');
      return;
    }
    runningState.lastRun = new Date();
    await fetchLdes();
    runningState.lastRun = null;
  },
});
