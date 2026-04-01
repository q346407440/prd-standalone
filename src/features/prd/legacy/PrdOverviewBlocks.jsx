import '../../../shared/styles/prd-table.css';
import '../editor/styles/prd-overview.css';

const MODAO_URL =
  'https://modao.cc/proto/zUAlxnpmsv23wiYJSX3u/sharing?view_mode=read_only&screen=rbpUnhOtKKm1qktkL#%E6%90%9C%E7%B4%A2%E7%BB%93%E6%9E%9C%E9%A1%B5%E4%BC%98%E6%83%A0%E7%A0%81%E6%8E%A8%E8%8D%90-%E5%88%86%E4%BA%AB';

const FIGMA_URL =
  'https://www.figma.com/design/hT3Qyzf53QZwLGUi5ew0rb/%E6%99%BA%E8%83%BD%E5%85%B3%E9%95%9C%E5%95%86%E6%90%9C%E7%B4%A2?node-id=1522-9000&t=j1mUnckyoPs8kXVO-1';

const COL_LABELS = ['需求名称', '系统端', '模块', '功能点', '功能描述'];

function FeatureTableRow({ cells }) {
  return (
    <tr>
      {cells.map((text, i) => (
        <td key={COL_LABELS[i]} data-prd-label={COL_LABELS[i]}>
          {text || '\u200b'}
        </td>
      ))}
    </tr>
  );
}

/**
 * PRD 页顶部：需求概述、需求功能清单、原型/设计链接（位于「产品详细功能说明」与各章节表格之上）
 */
export function PrdOverviewBlocks() {
  return (
    <div className="prd-overview">
      <section className="prd-overview__block">
        <h2 className="prd-overview__h2">需求概述</h2>
        <div className="prd-overview__subhead">目的/背景</div>
        <ol className="prd-overview__ol">
          <li>
            增加通知模块，目的是增加一个优化优惠码配置的通知，让商家能够感知当前的优惠码门槛是可以调整的。
          </li>
          <li>
            增加新数据指标，让商家能够明确感知到，当前搜索组件能够带来更好的效果环比。
          </li>
          <li>
            搜索组件的样式，支持 B 端配置，以及摆放位置配置。让商家能够通过自己配置的方式来适配其使用的主题风格。
          </li>
        </ol>
      </section>

      <section className="prd-overview__block">
        <h2 className="prd-overview__h2">需求功能清单</h2>
        <div className="prd-table-wrap">
          <table className="prd-table">
            <colgroup>
              <col className="prd-overview__col-name" />
              <col className="prd-overview__col-sys" />
              <col className="prd-overview__col-mod" />
              <col className="prd-overview__col-point" />
              <col className="prd-overview__col-desc" />
            </colgroup>
            <thead>
              <tr>
                {COL_LABELS.map((label) => (
                  <th key={label} scope="col">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <FeatureTableRow cells={['通知模块', '', '', '', '']} />
              <FeatureTableRow cells={['搜索绩效-新增数据指标', '', '', '', '']} />
              <FeatureTableRow cells={['搜索组件样式配置', '', '', '', '']} />
            </tbody>
          </table>
        </div>
      </section>

      <section className="prd-overview__block">
        <h2 className="prd-overview__h2">原型图汇总</h2>
        <p className="prd-overview__link-line">
          <a className="prd-overview__link" href={MODAO_URL} target="_blank" rel="noreferrer noopener">
            墨刀原型（搜索结果页优惠码推荐）
          </a>
        </p>
      </section>

      <section className="prd-overview__block">
        <h2 className="prd-overview__h2">设计图汇总</h2>
        <p className="prd-overview__link-line">
          <a className="prd-overview__link" href={FIGMA_URL} target="_blank" rel="noreferrer noopener">
            Figma 设计稿（智能关窗商搜索）
          </a>
        </p>
      </section>
    </div>
  );
}
