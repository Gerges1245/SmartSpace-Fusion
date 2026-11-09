"""Extract actual MediaPipe palm trajectories from Hands videos; cache for repeatable tests."""
import argparse
import itertools
import json
import math
import sys
from pathlib import Path
import cv2
import mediapipe as mp

ROOT=Path(__file__).resolve().parents[1]


def extract(path, rate=15):
    cap=cv2.VideoCapture(str(path));fps=cap.get(cv2.CAP_PROP_FPS);count=int(cap.get(cv2.CAP_PROP_FRAME_COUNT));stride=max(1,round(fps/rate));aspect=cap.get(cv2.CAP_PROP_FRAME_WIDTH)/max(1,cap.get(cv2.CAP_PROP_FRAME_HEIGHT));tracks={};next_id=0
    with mp.solutions.hands.Hands(max_num_hands=2,model_complexity=0,min_detection_confidence=.5,min_tracking_confidence=.5) as detector:
        for frame_no in range(count):
            ok,frame=cap.read()
            if not ok:break
            if frame_no%stride:continue
            t=frame_no/fps
            if frame.shape[1]>640:frame=cv2.resize(frame,(640,round(frame.shape[0]*640/frame.shape[1])))
            result=detector.process(cv2.cvtColor(frame,cv2.COLOR_BGR2RGB));detected=[]
            for hand in result.multi_hand_landmarks or []:
                lm=hand.landmark;ids=(0,5,9,13,17);p=[1-sum(lm[i].x for i in ids)/5,sum(lm[i].y for i in ids)/5]
                roll=math.atan2(lm[0].x-lm[9].x,lm[0].y-lm[9].y)
                def distance(a,b):return math.sqrt(sum((getattr(lm[a],axis)-getattr(lm[b],axis))**2 for axis in ('x','y','z')))
                openness=sum(distance(base,base+3)/max(.00001,sum(distance(j,j+1) for j in range(base,base+3))) for base in (5,9,13,17))/4
                detected.append([*p,roll,openness])
            available=[key for key,track in tracks.items() if t-track[-1][0]<.6]
            candidates=[]
            for assignment in itertools.product(available+[None],repeat=len(detected)):
                used=[key for key in assignment if key is not None]
                if len(set(used))!=len(used):continue
                score=0
                for p,key in zip(detected,assignment):
                    distance=math.dist(p[:2],tracks[key][-1][1:3]) if key is not None else .5
                    score+=distance if distance<.3 or key is None else 100
                candidates.append((score,assignment))
            assignment=min(candidates,key=lambda x:x[0])[1] if candidates else []
            for p,key in zip(detected,assignment):
                if key is None:key=str(next_id);next_id+=1;tracks[key]=[]
                tracks[key].append([t,*p])
    cap.release()
    return {'video':str(path.relative_to(ROOT)).replace('\\','/'),'label':'Bye Bye' if path.parent.name.lower() in ('byr','bye','bye bye') else 'Other','duration':count/fps,'fps':fps,'aspect':aspect,'tracks':tracks}


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--refresh',action='store_true');args=parser.parse_args()
    target=ROOT/'tools/wave-data/landmarks.json'
    if target.exists() and not args.refresh:print('Using cached extraction:',target);return
    videos=[]
    for path in sorted((ROOT/'Hands').glob('*/*.mp4')):
        data=extract(path);videos.append(data);print(path.parent.name,path.name,'tracked frames',sum(map(len,data['tracks'].values())),flush=True)
    target.parent.mkdir(exist_ok=True);target.write_text(json.dumps({'source':'Hands videos / MediaPipe Hands 0.10.21','videos':videos}),encoding='utf-8')


if __name__=='__main__':main()
