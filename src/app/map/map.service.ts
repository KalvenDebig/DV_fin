import { Participant } from './../shared/participant.model';
import { EventEmitter, Injectable } from '@angular/core';
import { HttpHeaders, HttpClient, HttpParams, HttpErrorResponse } from '@angular/common/http';

import { Subject } from 'rxjs/Subject';
import {  Observable } from 'rxjs/Observable';
import { Tracker } from '../shared/tracker.model';
import { SettingService } from './../setting/setting.service';
import { Subscription } from 'rxjs/Subscription';

@Injectable()
export class MapService {
    private httpOptions;
    // map doamin
    private base = {width: 100, height: 50};
    private mapPosScale = {offsetX: 0, offsetY: 0, scale: 1};
    // tracker boundary
    private trackerBoundary = {x: 22, y: 20};

    constructor(private httpClient: HttpClient,
        private settingService: SettingService) {
            this.httpOptions = {
               headers: new HttpHeaders({
                 'Content-Type':  'application/json',
                 'Authorization': 'my-auth-token'
               }),
               participantUrl: () =>  this.settingService.getApis('participant'),
               eventUrl: () => this.settingService.getApis('event'),
             };
        this.getMapSettings();
        this.initDummyTrackers(this.base);
     }


    trackerLocChanges = new Subject<{trackers: Tracker[], dur: number}>();
    trackerListChanges = new Subject<Tracker[]>();
    serviceInterval: any;

    mapInitiated = false;
    mapStarted = false;
    mapStopping = false;
    mapStopped = true;

    started = new Subject<boolean>();
    stopped = new Subject<boolean>();
    stopping = new Subject<boolean>();
    intiated = new Subject<boolean>();
    onStarted = new Subject<boolean>();
    onStopped = new Subject<boolean>();
    onLoading = new Subject<boolean>();
    onLoaded = new Subject<boolean>();
    onPaused = new Subject<boolean>();
    dropdownFolded = new Subject<boolean>();

    pageBlur = new Subject<boolean>();
    pageBlurHinted = false;
    windowResized = new Subject<void> ();

    // TODO restructure the selected Tracker
    selectedTrackerId: number;
    selectedTrackerIndex = new Subject<number>();
    hasSelectedTracker = new Subject<number>();
    hideTrackerIndex = new Subject<number>();

    // tracker history local
    trackerLocsReady = new Subject<any> ();
    trackerLocsListener: Subscription;

    sse$: Subscription;
    eventSource: EventSource;
    realTimeSubject = new Subject<any>();
    playbackTimer: any;

    trackerLocsSet = [];
    onTest = new EventEmitter<boolean>();
    
    sliderSubject  = new Subject<number>();
    sysTime: any;
    minP: number;
    maxP: number;
    curP: number;

    // TODO those are participants
    private trackers: Tracker[];
    // dummy move
    private step = [
        [-1, -1], [0, -1], [1, -1],
        [-1, -0], [0, 0], [1, 0],
        [-1, 1], [0, 1], [1, 1]
    ];
    private SSECheck: any;
    /**
     * base
     * tracker boundary
     */
    getMapSettings() {
        this.base = this.settingService.getMapSettingBase();
        this.trackerBoundary = this.settingService.getMapSettingTrackerBoundary();
        this.mapPosScale = this.settingService.getMapSettingPosScale();
        return {base: {...this.base}, mapPosScale: {...this.mapPosScale}};
    }

    settrackerBoundary(x: number, y: number) {
        this.trackerBoundary.x = x ?  x : this.trackerBoundary.x;
        this.trackerBoundary.y = y ?  y : this.trackerBoundary.y;
    }

    /**offsetX: number, offsetY: number, scale: number */
    updateMapSettings(mapPosScale: {offsetX: number, offsetY: number, scale: number}) {
        Object.keys(mapPosScale).forEach(key => {
            const value = mapPosScale[key];
            if (this.mapPosScale[key] !== value) {
                console.log(this.mapPosScale[key], value);
                this.settingService.updateMapSetting(key, value.toString());
            }
        });
    }

    initDummyTrackers(base: {width: number, height: number}) {
        this.trackers = [
            new Tracker(1, '', 1 / 100 * base.width, 1 / 50 * base.height, null),
            new Tracker(2, '', 1 / 100 * base.width, 49 / 50 * base.height, null),
            new Tracker(3, '', 99 / 100 * base.width, 1 / 50 * base.height, null),
            new Tracker(4, '', 99  / 100 * base.width, 49 / 50 * base.height, null),
            new Tracker(5, '', 10 / 100 * base.width, 10 / 50 * base.height, null),
            new Tracker(6, '', 50  / 100 * base.width, 20 / 50 * base.height, null),
            new Tracker(7, '', 30  / 100 * base.width, 30 / 50 * base.height, null),
            new Tracker(8, '', 80  / 100 * base.width, 40 / 50 * base.height, null),
            new Tracker(9, '', 10  / 100 * base.width, 10 / 50 * base.height, null),
            new Tracker(10, '', 42  / 100 * base.width, 34 / 50 * base.height, null),
            new Tracker(11, '', 20  / 100 * base.width, 37 / 50 * base.height, null),
            new Tracker(12, '', 40  / 100 * base.width, 45 / 50 * base.height, null),
        ];
    }

    setSysTime(time: any) {
        this.sysTime = time;
    }

    start() {
        console.log('am I ever called?');
        this.onStarted.next(this.mapStarted);
    }

    startSync() {
        console.log('startSync', this.mapStarted);
        if (this.mapStarted) {
            console.log('already start emit1');
            this.onStarted.next(this.mapStarted);
            return;
        }

        if (this.mapInitiated) {
            console.log('already start emit2');
            this.onStarted.next(this.mapStarted);
            return;
        }
        // change table name: simulation_2 accordingly;
        this.getLastActiveTrackers();
        this.onLoading.next(true);
        const listChangeSub = this.trackerListChanges.subscribe(() => {
            listChangeSub.unsubscribe();

            const customer_ids =  this.trackers.map(tracker => tracker.tagId);
            this.getLocationRealTime();
            this.sse$ = this.realTimeSubject.subscribe(data => {
                this.sse$.unsubscribe();
                const locations = JSON.parse(data);
                this.trackers.forEach(trac => {
                    const location = locations.find((loc: any) => loc.tracker_id === trac.tagId);
                    trac.setCrd((location.loc_x + 0.5) / this.trackerBoundary.x * this.base.width,
                        (location.loc_y + 0.5) / this.trackerBoundary.y * this.base.width);
                });

                this.onLoaded.next(true);
                console.log('onStarted 167');
                this.onStarted.next(this.mapStarted);
            });
            // this.getParticipantLocalsByIds(customer_ids).subscribe(
            //     (result) => {
            //       const data = result['data'];
            //       this.trackers.forEach(trac => {
            //           console.log(trac);
            //         //   console.log(data,data[`${trac.tagId}`])
            //         trac.setCrd((data[trac.tagId].loc_x + 0.5) / this.trackerBoundary.x * this.base.width,
            //         (data[trac.tagId].loc_y + 0.5) / this.trackerBoundary.y * this.base.width);
            //       });
            //         // Whenever get the trackers, ready to call
            //         this.onLoaded.next(true);
            //         this.onStarted.next(this.mapStarted);
            //     }, (err: HttpErrorResponse)  => {
            //       console.error(err);
            //     }
            // );
        });
    }

    pause() {
 
        if (this.trackerLocsListener) {
            this.trackerLocsListener.unsubscribe();
        }

        if (this.serviceInterval) {
            console.log('clearInterval');
            clearInterval(this.serviceInterval);
        }

        if (this.sse$) {
            this.sse$.unsubscribe();
        }
        this.onPaused.next();
    }


    stop() {
        this.pause();
        this.onStopped.next(this.mapStopped);
    }



    resetServiceState() {
        this.mapStopping = true;
        this.stopping.next(this.mapStopping);
        this.mapStarted = false;
        this.started.next(this.mapStarted);
        // this.onStarted.next(this.mapStarted);
        this.mapStopped = true;
        this.stopped.next(this.mapStopped);
        this.mapInitiated = false;
        this.intiated.next(this.mapInitiated);
    }

    stopService() {
        this.resetServiceState();
        this.closeEventSource();
        if (this.serviceInterval) {
            clearInterval(this.serviceInterval);
        }
    }

    getTrackers() {
        return this.trackers.slice();
    }

    getTracker(index: number) {
        return this.trackers.slice()[index];
    }

    getTrackerTime(index: number) {
        if (this.trackers.slice()[index].time) {
            return this.trackers.slice()[index].time;
        }
        return null;
    }

    getTrackerAlias(index: number) {
        if (this.trackers.slice()[index].alias) {
            return this.trackers.slice()[index].alias;
        }
        return null;
    }


    move() {
        console.log('move()');
        this.sse$ = this.realTimeSubject.subscribe(data => {
            const locations = JSON.parse(data);
            this.trackers.forEach(trac => {
                const location = locations.find((loc: any) => loc.tracker_id === trac.tagId);
                trac.setCrd((location.loc_x + 0.5) / this.trackerBoundary.x * this.base.width,
                    (location.loc_y + 0.5) / this.trackerBoundary.y * this.base.width);
                trac.addLastLoc(location);
            });
            console.log('trackerLocChanges sse2');
            this.trackerLocChanges.next({trackers: [...this.trackers], dur: 1000});
        });
        // clearInterval(this.serviceInterval);
        // this.serviceInterval = setInterval(() => {
        //     // dunmmyMove
        //     // this.trackers.map(tracker => {
        //     //     this.dummyMove(tracker);
        //     // });
        //     // this.trackerLocChanges.next(this.trackers.slice());

        //     // realMove
        //     this.realtimeMove();
        // }, 800);
    }

    realtimeMove() {
        const customer_ids = this.trackers.map(tracker => tracker.tagId);
        this.getParticipantLocalsByIds(customer_ids).subscribe(
           (result) => {
             const data = result['data'];
             this.trackers.forEach(trac =>
               trac.setCrd((data[trac.tagId].loc_x + 0.5) / this.trackerBoundary.x * this.base.width,
               (data[trac.tagId].loc_y + 0.5) / this.trackerBoundary.y * this.base.width));
               console.log(this.trackers[0]);
               this.trackerLocChanges.next({trackers: [...this.trackers], dur: 1000});
        });
    }

    dummyMove(tracker: Tracker) {
        const dirc = this.step[Math.floor(Math.random() * 9)];
        tracker.xCrd = tracker.xCrd + dirc[0];
        tracker.yCrd = tracker.yCrd + dirc[1];

        if (tracker.xCrd <= 0) {
            tracker.xCrd  = 1;
        }
        if (tracker.xCrd >= this.base.width) {
            tracker.xCrd = this.base.width - 1;
        }
        if (tracker.yCrd <= 0) {
            tracker.yCrd = 1 ;
        }
        if (tracker.yCrd >= this.base.height  ) {
            tracker.yCrd = this.base.height - 1;
        }
        return tracker;
    }

　　onSelectedTracker(id: number) {
        this.selectedTrackerIndex.next(id);
    }

    onTrackerHasSelected(id: number) {
        this.hasSelectedTracker.next(id);
    }

    hideTracker(id: number) {
        const newTrackers = this.trackers.map(
            tracker => {
                if (tracker.id === id) {
                    tracker.activated = !tracker.isActivated();
                    console.log('this point activated?' , tracker.isActivated());
                    console.log('this point selected?' , tracker.selected);
                }
                return tracker;
            }
        );
        this.trackers = newTrackers;
        this.trackerLocChanges.next({trackers: [...this.trackers], dur: 1000});
        this.hideTrackerIndex.next(id);
    }

    onCompanyDropdownFolded(folded: boolean) {
        this.dropdownFolded.next(folded);
    }

    updateTrackerInfo(index: number, form: any) {
        console.log('update', index, form.alias);
        // TODO replace this after having backend;
        this.trackers[index].alias = form.alias;
        this.trackerLocChanges.next({trackers: [...this.trackers], dur: 1000});
    }

    getParticipantListByFilters(filters: object, offset?: number, limit?: number) {
        const urlSuffix = 'list/filter';
        let options = new HttpParams();
        if (offset) {
          options = options.append('offset', offset.toString());
        }
        // Check participant service if need more condition filter

        return this.httpClient.post(`${this.httpOptions.participantUrl()}/${urlSuffix}`, filters, {
            observe: 'body',
            responseType: 'json',
            params: options
          })
          .subscribe(
              (result) => {
                // should be some where else
                this.stop();
                const participants = result['data']['participants'];
                // console.log(participants);
                if (participants && participants.length > 0) {
                    this.changeTrackers(participants);
                } else {
                    return false;
                }
              }, (err: HttpErrorResponse)  => {
                console.error(err);
              }
          );
    }

    changeTrackers(trackers_) {
        // const trackers = [];
        // participants.forEach((participant, i) => {
        //   const tracker = new Tracker(i + 1, participant['tag_id'], null, null, new Participant(participant));
        //   trackers.push(tracker);
        //   if (i === participants.length - 1) {
        //     this.trackers = trackers.slice();
        //     console.log('DEBUG changeTrackers');
        //      console.log('DEBUG', this.trackers);
        //     this.trackerListChanges.next();
        //   }
        // });

        const trackers = trackers_.map((tracker, i) => {
           return new Tracker(i + 1, tracker['tracker_id'], null, null, null);
        });

        this.trackers = trackers.slice();
        this.trackerListChanges.next();
    }

    getParticipantLocalsByTime(id: string, begin?: number, end?: number) {
        const urlSuffix = 'locations';
        const con = {'begin': begin, 'end': end, 'tracker_id': id};
        // console.log('DEBUG', con);
        return this.httpClient.post(`${this.httpOptions.eventUrl()}/${urlSuffix}`, con, {
            observe: 'body',
            responseType: 'json',
          })
          .subscribe(
              (result) => {
                const data = result['data'];
                // console.log('DEBUG', 'getParticipantLocalsByTime', data);
                this.trackerLocsReady.next(data);
              }, (err: HttpErrorResponse)  => {
                console.error(err);
              }
          );
    }

    public closeEventSource() {
        if (!!this.eventSource) {
           this.eventSource.close();
        }
    }

    getLocationRealTime() {
        this.closeEventSource();
        const urlSuffix = 'real_time/simulate';
        const url = `${this.httpOptions.eventUrl()}/${urlSuffix}`;
        this.eventSource = new EventSource(url);

        return Observable.create(observer => {
            this.eventSource.onmessage = x => observer.next(x.data);
            this.eventSource.onerror = x => observer.error(x);
        }).subscribe(data => {
            this.realTimeSubject.next(data);
        });
    }

    getParticipantLocalsByIds(ids: string[], begin?: number, end?: number) {
        const urlSuffix = 'tracker/locs/current';
        const con = {'begin': begin, 'end': end, 'ids': ids};
        return this.httpClient.post(`${this.httpOptions.eventUrl()}/${urlSuffix}`, con, {
            observe: 'body',
            responseType: 'json',
          });
    }

    getLastActiveTrackers() {
        const urlSuffix = 'tracker/last_active';
        const limit = 15;
        return this.httpClient.get(`${this.httpOptions.eventUrl()}/${urlSuffix}`, {
            observe: 'body',
            responseType: 'json',
          })
          .subscribe(
              (result) => {
                const trackers = result['data'];
                console.log('DEBUG getLastActiveTracker', trackers);
                if (trackers && trackers.length > 0) {
                    // this.stop();
                    this.changeTrackers(trackers);
                } else {
                    this.onLoaded.next(false);
                }
              }, (err: HttpErrorResponse)  => {
                console.error(err);
              }
          );
    }

    /**
     * 20/17 is the max I can see in the simulation_data
     * loc_x/y will always between 20/17
     * Eventually this.base.width should eqaul to 20
     *  this.base.height should eqaul to 17
     *
     */
    testHistoryLocals() {
        // map particiapnt id, pass the id
        // TODO put getLastActive under subscribe
        console.log('testHistoryLocals', this.mapStarted);
        if (this.mapStarted) {
            this.onTest.next(this.mapStarted);
            return;
        }

        if (this.mapInitiated) {
            this.onTest.next(this.mapStarted);
            return;
        }
        this.getLastActiveTrackers();   // =>  this.changeTrackers(trackers);  => trackerListChanges
        this.onLoading.next(true);
        const listChangeSub = this.trackerListChanges.subscribe(() => {
            listChangeSub.unsubscribe();
            const customer_ids =  this.trackers.map(tracker => tracker.tagId);
              // TODO put getParticipantLocalsByTime under subscribe
            customer_ids.map(id => this.getParticipantLocalsByTime(id));
            let customer_ids_index = 1;
            this.trackerLocsListener = this.trackerLocsReady.subscribe(data => {
                this.trackers.forEach(trac => {
                    if (trac.tagId === data[0].tracker_id) {
                        // API
                        trac.setCrd((data[0].loc_x + 0.5) / this.trackerBoundary.x * this.base.width,
                             (data[0].loc_y + 0.5) / this.trackerBoundary.y * this.base.width);
                        trac.setLocs(data, 0);
                        // all ready
                        if (customer_ids_index === customer_ids.length) {
                            this.minP = 1;
                            this.maxP = data.length;

                            this.trackerLocsListener.unsubscribe();
                            // this.trackerListChanges.next();
                            this.onLoaded.next(true);
                            this.onTest.next(this.mapStarted);
                         } else {
                           customer_ids_index++;
                         }
                    }
                });
                // const tracker = new Tracker(customer_ids_index, data[0].customer_id, data[0].loc_x/20*95, data[0].loc_y/17*45)
                // tracker.setLocs(data, 0);
                // tracker.setCrd(tracker.locs[0].loc_x / 20 * 95, tracker.locs[0].loc_y / 17 * 45);
                // this.trackers.push(tracker);
                // if (customer_ids_index === customer_ids.length) {
                //    this.trackerListChanges.next();
                //    this.onTest.next(this.mapStarted);
                // } else {
                //   customer_ids_index++;
                // }
            });
        });
    }

    // Historical Move Timer
    testMove() {
        clearInterval(this.serviceInterval);
        this.serviceInterval = setInterval(() => {
            this.trackers.map((tracker, index) => {
                this.testMoveHis(tracker, index);
            });
            // console.log(this.sysTime);
            this.trackerLocChanges.next({trackers: [...this.trackers], dur: 1000});
        }, 800);
    }

    /**
     * trackerBoundary.x/y (20/17) is the max I can see in the simulation_data
     * loc_x/y will always between 20/17
     * Eventually this.base.width should eqaul to trackerBoundary.x
     *  this.base.height should eqaul to trackerBoundary.y
     *
     * TODO
     */

     // Historical Time
    testMoveHis(tracker: Tracker, index: number) {

        const nextLocIndex = tracker.currentLoc < tracker.locs.length ? tracker.currentLoc + 1 : 0;
        const nextLoc = tracker.locs[nextLocIndex];
        tracker.currentLoc = nextLocIndex;
        tracker.setCrd((nextLoc.loc_x + 0.5) / this.trackerBoundary.x * this.base.width,
            (nextLoc.loc_y + 0.5)  / this.trackerBoundary.y * this.base.height);
        // tracker.setTime(nextLoc.time * 1000);
        tracker.setTime(nextLoc.time );

        if (index === 0) {
            this.setSysTime(nextLoc.time);
            this.playSliderP(nextLocIndex);
        }
        // this.trackerLocChanges.next(this.trackers.slice());
    }

    setSliderP(p: number): void {
        this.curP = Math.floor(p / this.maxP * 100);
    }

    playSliderP(p: number): void {
        this.setSliderP(p);
        this.sliderSubject.next(this.curP);
    }

    changeSliderP(p): void {
        const index = this.getSliderIndex(p);

        this.trackers.map((tracker) => {
            tracker.currentLoc = index;
            const nextLoc = tracker.locs[index];
            tracker.setCrd((nextLoc.loc_x + 0.5) / this.trackerBoundary.x * this.base.width,
            (nextLoc.loc_y + 0.5)  / this.trackerBoundary.y * this.base.height);
            // tracker.setTime(nextLoc.time * 1000);
            tracker.setTime(nextLoc.time );
        });
        // console.log(this.sysTime);
        this.trackerLocChanges.next({trackers: [...this.trackers], dur: 0});
    }

    getSlideP(): number {
        return this.curP ? 1 : this.curP;
    }

    getSliderIndex(p: number) {
        return Math.ceil(this.maxP * p / 100);
    }

    onChangeTrackerColor(id: number, color: string) {
        this.trackers[id - 1].setColor(color);
        this.trackerLocChanges.next({trackers: [...this.trackers], dur: 1000});
    }

    onLeavePage() {
        if (!this.pageBlurHinted) {
            this.pageBlur.next();
            this.pageBlurHinted = true;
        }
    }

    onWindowResize() {
        this.windowResized.next();
    }
}
