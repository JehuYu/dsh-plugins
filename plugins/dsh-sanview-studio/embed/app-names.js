/* Shared label tables. The inspector renders them and the document validator uses them to recognise object types. */
(function(root){
'use strict';
const kindNames={horizontal:'距离',vertical:'距离',linear:'距离',aligned:'距离',diameter:'直径',radius:'半径',angle:'角度',arcLength:'弧长',chordLength:'弦长'};
const partNames={extension1:'尺寸界线 1',extension2:'尺寸界线 2',line:'尺寸线',arc:'尺寸弧',leader:'引出线',shelf:'引出平台',arrow1:'箭头 1',arrow2:'箭头 2',number:'尺寸数字'};
const typeNames={line:'直线',rect:'矩形',circle:'圆',arc:'圆弧',profile:'形体',poly:'折线',path:'复合图形',text:'文字',dim:'尺寸标注'};
const profileNames={rect:'矩形',roundrect:'圆角矩形',slot:'腰孔',hexagon:'正六边形',triangle:'直角三角形',trapezoid:'梯形'};
const diameterStyles={auto:'随放置位置排布',inside:'圆内标注',outside:'圆外箭头',leader:'折线引出',horizontal:'水平外标',vertical:'垂直外标'};
const radiusStyles={auto:'随放置位置排布',outside:'圆外直注',leader:'圆外折线',inside:'圆内折线',short:'短引线直注','short-leader':'短引线折线'};
const distanceStyles={auto:'自动排布',inside:'内侧标注',outside:'外侧箭头',leader:'折线引出','horizontal-text':'水平读数',miter:'45° 斜线标注'};
root.AppNames={kindNames,partNames,typeNames,profileNames,diameterStyles,radiusStyles,distanceStyles};if(typeof module!=='undefined'&&module.exports)module.exports=root.AppNames;
})(typeof window!=='undefined'?window:globalThis);
